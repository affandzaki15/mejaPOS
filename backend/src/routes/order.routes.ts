import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";

const router = Router();

// GET: Menampilkan semua pesanan
router.get("/", async (_req, res) => {
  try {
    const orders = await prisma.orders.findMany({
      include: {
        order_items: true,
        restaurant_tables: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    res.json({
      success: true,
      total: orders.length,
      data: orders,
    });
  } catch (error) {
    console.error("Failed to fetch orders:", error);

    res.status(500).json({
      success: false,
      message: "Gagal mengambil data pesanan",
    });
  }
});

// POST: Membuat pesanan baru
router.post("/", async (req, res) => {
  const orderSchema = z.object({
    order_number: z.string().trim().min(1),
    order_type: z.enum(["DINE_IN", "TAKEAWAY"]),
    source: z.enum(["QR", "CASHIER"]),
    restaurant_table_id: z.number().int().positive().nullable().optional(),
    items: z
      .array(
        z.object({
          menu_item_id: z.number().int().positive(),
          quantity: z.number().int().positive(),
          notes: z.string().optional(),
        }),
      )
      .min(1),
  });

  const validation = orderSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({
      success: false,
      message: "Validasi gagal",
      errors: validation.error.flatten().fieldErrors,
    });
    return;
  }

  const { order_number, order_type, source, restaurant_table_id, items } =
    validation.data;

  try {
    const order = await prisma.$transaction(async (tx) => {
      const menuIds = [...new Set(items.map((item) => item.menu_item_id))];

      const menus = await tx.menu_items.findMany({
        where: {
          id: { in: menuIds },
          is_available: true,
        },
      });

      if (menus.length !== menuIds.length) {
        throw new Error("MENU_NOT_AVAILABLE");
      }

      if (order_type === "DINE_IN" && !restaurant_table_id) {
        throw new Error("TABLE_REQUIRED");
      }

      const total = items.reduce((sum, item) => {
        const menu = menus.find((m) => m.id === item.menu_item_id)!;
        return sum + Number(menu.price) * item.quantity;
      }, 0);

      return tx.orders.create({
        data: {
          order_number,
          order_type,
          source,
          restaurant_table_id: restaurant_table_id ?? null,
          payment_status: "UNPAID",
          order_status: "PENDING_PAYMENT",
          total_amount: total,
          order_items: {
            create: items.map((item) => {
              const menu = menus.find((m) => m.id === item.menu_item_id)!;

              return {
                menu_item_id: menu.id,
                menu_name: menu.name,
                quantity: item.quantity,
                unit_price: menu.price,
                subtotal: Number(menu.price) * item.quantity,
                notes: item.notes ?? null,
              };
            }),
          },
        },
        include: {
          order_items: true,
        },
      });
    });

    res.status(201).json({
      success: true,
      message: "Pesanan berhasil dibuat",
      data: order,
    });
  } catch (error) {
    console.error("Failed to create order:", error);

    if (error instanceof Error && error.message === "MENU_NOT_AVAILABLE") {
      res.status(400).json({
        success: false,
        message: "Menu tidak ditemukan atau sedang tidak tersedia",
      });
      return;
    }

    if (error instanceof Error && error.message === "TABLE_REQUIRED") {
      res.status(400).json({
        success: false,
        message: "Pesanan dine-in wajib memiliki meja",
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: "Gagal membuat pesanan",
    });
  }
});

// GET: Melihat riwayat perubahan status pesanan
router.get("/:id/history", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({
      success: false,
      message: "ID pesanan tidak valid",
    });
    return;
  }

  try {
    const order = await prisma.orders.findUnique({
      where: { id },
    });

    if (!order) {
      res.status(404).json({
        success: false,
        message: "Pesanan tidak ditemukan",
      });
      return;
    }

    const history = await prisma.order_status_history.findMany({
      where: { order_id: id },
      orderBy: { created_at: "asc" },
    });

    res.json({
      success: true,
      message: "Riwayat pesanan berhasil diambil",
      data: history,
    });
  } catch (error) {
    console.error("Failed to get order history:", error);

    res.status(500).json({
      success: false,
      message: "Gagal mengambil riwayat pesanan",
    });
  }
});

// PUT: Memperbarui status pesanan
// PUT: Memperbarui status pesanan sekaligus mencatat riwayatnya
router.put("/:id/status", async (req, res) => {
  const id = Number(req.params.id);

  const statusSchema = z.object({
    order_status: z.enum([
      "NEW",
      "PREPARING",
      "READY",
      "COMPLETED",
      "CANCELLED",
    ]),
  });

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({
      success: false,
      message: "ID pesanan tidak valid",
    });
    return;
  }

  const validation = statusSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({
      success: false,
      message: "Status pesanan tidak valid",
    });
    return;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Ambil pesanan sebelum statusnya diubah
      const existingOrder = await tx.orders.findUnique({
        where: { id },
      });

      if (!existingOrder) {
        throw new Error("ORDER_NOT_FOUND");
      }

      const previousStatus = existingOrder.order_status;
      const newStatus = validation.data.order_status;

      // Aturan perpindahan status pesanan
      const allowedTransitions: Record<string, string[]> = {
        PENDING_PAYMENT: ["CANCELLED"],
        NEW: ["PREPARING", "CANCELLED"],
        PREPARING: ["READY", "CANCELLED"],
        READY: ["COMPLETED", "CANCELLED"],
        COMPLETED: [],
        CANCELLED: [],
      };

      if (!allowedTransitions[previousStatus]?.includes(newStatus)) {
        throw new Error("INVALID_STATUS_TRANSITION");
      }

      // Ubah status pesanan
      const updatedOrder = await tx.orders.update({
        where: { id },
        data: {
          order_status: newStatus,
        },
      });

      // Catat riwayat perubahan status
      await tx.order_status_history.create({
        data: {
          order_id: id,
          previous_status: previousStatus,
          new_status: newStatus,
          changed_by: null,
          notes: "Status diperbarui melalui API",
        },
      });

      return updatedOrder;
    });

    res.json({
      success: true,
      message: "Status pesanan berhasil diperbarui",
      data: result,
    });
  } catch (error) {
    console.error("Failed to update order status:", error);

    if (error instanceof Error && error.message === "ORDER_NOT_FOUND") {
      res.status(404).json({
        success: false,
        message: "Pesanan tidak ditemukan",
      });
      return;
    }

    if (
      error instanceof Error &&
      error.message === "INVALID_STATUS_TRANSITION"
    ) {
      res.status(400).json({
        success: false,
        message: "Transisi status pesanan tidak diizinkan",
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: "Gagal memperbarui status pesanan",
    });
  }
});

export default router;
