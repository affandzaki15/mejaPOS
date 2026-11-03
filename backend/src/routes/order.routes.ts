import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import {
  authenticateToken,
  authorizeRole,
} from "../middleware/auth.middleware.js";

const modifyOrderSchema = z.object({
  reason: z.string().trim().min(3),
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

type ModifyOrderInput = z.infer<typeof modifyOrderSchema>;


const router = Router();

// GET: Menampilkan semua pesanan
router.get(
  "/",
  authenticateToken,
  authorizeRole("ADMIN", "CASHIER", "KITCHEN"),
  async (_req, res) => {
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
  },
);

// POST: Membuat pesanan baru
router.post(
  "/",
  (req, res, next) => {
    // Pemesanan QR tetap publik.
    if (req.body?.source === "QR") {
      next();
      return;
    }

    // Pemesanan manual wajib login sebagai Admin atau Cashier.
    authenticateToken(req, res, () => {
      authorizeRole("ADMIN", "CASHIER")(req, res, next);
    });
  },
  async (req, res) => {
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

    const modifyOrderSchema = z.object({
      reason: z.string().trim().min(3, "Alasan koreksi minimal 3 karakter"),
      items: z
        .array(
          z.object({
            menu_item_id: z.number().int().positive(),
            quantity: z.number().int().positive(),
            notes: z.string().optional(),
          }),
        )
        .min(1, "Pesanan harus memiliki minimal satu item"),
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
  },
);

// GET: Melihat riwayat perubahan status pesanan
router.get(
  "/:id/history",
  authenticateToken,
  authorizeRole("ADMIN", "CASHIER", "KITCHEN"),
  async (req, res) => {
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
  },
);

// PUT: Memperbarui status pesanan
// PUT: Memperbarui status pesanan sekaligus mencatat riwayatnya
router.put(
  "/:id/status",
  authenticateToken,
  authorizeRole("ADMIN", "KITCHEN"),
  async (req, res) => {
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

        if (
          req.user!.role === "KITCHEN" &&
          !(
            (previousStatus === "NEW" && newStatus === "PREPARING") ||
            (previousStatus === "PREPARING" && newStatus === "READY")
          )
        ) {
          throw new Error("KITCHEN_STATUS_FORBIDDEN");
        }
        // Pesanan harus dibayar sebelum masuk ke dapur
        if (newStatus === "NEW" && existingOrder.payment_status !== "PAID") {
          throw new Error("ORDER_NOT_PAID");
        }
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
            changed_by: req.user!.id,
            notes: `Status diperbarui oleh ${req.user!.role}`,
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

      if (error instanceof Error && error.message === "ORDER_NOT_PAID") {
        res.status(400).json({
          success: false,
          message: "Pesanan belum dibayar dan tidak dapat masuk ke dapur",
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: "Gagal memperbarui status pesanan",
      });

      if (
        error instanceof Error &&
        error.message === "KITCHEN_STATUS_FORBIDDEN"
      ) {
        res.status(403).json({
          success: false,
          message:
            "Kitchen hanya boleh mengubah status menjadi PREPARING atau READY",
        });
        return;
      }
    }
  },
);

router.put(
  "/:id/items",
  authenticateToken,
  authorizeRole("ADMIN", "CASHIER"),
  async (req, res) => {
  const orderId = Number(req.params.id);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    res.status(400).json({
      success: false,
      message: "ID pesanan tidak valid",
    });
    return;
  }

  const parsed = modifyOrderSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Data koreksi tidak valid",
      errors: parsed.error.flatten(),
    });
    return;
  }

  const input: ModifyOrderInput = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Kunci baris pesanan agar tidak dikoreksi bersamaan
      // dengan transaksi lain yang juga mengunci baris ini.
      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: number;
          order_status: string;
          payment_status: string;
          total_amount: unknown;
        }>
      >`
        SELECT id, order_status, payment_status, total_amount
        FROM orders
        WHERE id = ${orderId}
        FOR UPDATE
      `;

      const order = lockedOrders[0];

      if (!order) {
        throw new Error("ORDER_NOT_FOUND");
      }

      if (
        order.order_status === "COMPLETED" ||
        order.order_status === "CANCELLED" ||
        order.order_status === "READY"
      ) {
        throw new Error("ORDER_CANNOT_BE_MODIFIED");
      }

    const user = await tx.users.findUnique({
  where: { id: req.user!.id },
  select: { id: true },
});

      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }

      const existingItems = await tx.order_items.findMany({
        where: { order_id: orderId },
      });

      const beforeData = {
        order_status: order.order_status,
        payment_status: order.payment_status,
        total_amount: Number(order.total_amount),
        items: existingItems.map((item) => ({
          menu_item_id: item.menu_item_id,
          menu_name: item.menu_name,
          quantity: item.quantity,
          unit_price: Number(item.unit_price),
          subtotal: Number(item.subtotal),
          notes: item.notes,
        })),
      };

      const menuIds: number[] = [
        ...new Set(input.items.map((item) => item.menu_item_id)),
      ];

      const menus = await tx.menu_items.findMany({
        where: {
          id: { in: menuIds },
          is_available: true,
        },
      });

      if (menus.length !== menuIds.length) {
        throw new Error("MENU_NOT_AVAILABLE");
      }

      const menuMap = new Map(menus.map((menu) => [menu.id, menu]));

      const newItems = input.items.map((item) => {
        const menu = menuMap.get(item.menu_item_id);

        if (!menu) {
          throw new Error("MENU_NOT_AVAILABLE");
        }

        const unitPrice = Number(menu.price);
        const subtotal = unitPrice * item.quantity;

        return {
          order_id: orderId,
          menu_item_id: menu.id,
          menu_name: menu.name,
          quantity: item.quantity,
          unit_price: unitPrice,
          subtotal,
          notes: item.notes ?? null,
        };
      });

      const newTotal = newItems.reduce(
        (sum: number, item) => sum + item.subtotal,
        0,
      );

      // Belum mengizinkan perubahan total pesanan yang sudah dibayar.
      if (
        order.payment_status === "PAID" &&
        newTotal !== Number(order.total_amount)
      ) {
        throw new Error("PAID_ORDER_TOTAL_MISMATCH");
      }

      const afterData = {
        order_status: order.order_status,
        payment_status: order.payment_status,
        total_amount: newTotal,
        items: newItems,
      };

      await tx.order_items.deleteMany({
        where: { order_id: orderId },
      });

      await tx.order_items.createMany({
        data: newItems,
      });

      const updatedOrder = await tx.orders.update({
        where: { id: orderId },
        data: {
          total_amount: newTotal,
          updated_at: new Date(),
        },
      });

      await tx.order_modifications.create({
        data: {
          order_id: orderId,
          modified_by: req.user!.id,
          modification_reason: input.reason,
          before_data: beforeData,
          after_data: afterData,
        },
      });

      return updatedOrder;
    });

    res.status(200).json({
      success: true,
      message: "Pesanan berhasil dikoreksi",
      data: result,
    });
  } catch (error) {
    if (error instanceof Error) {
      const errors: Record<string, { status: number; message: string }> = {
        ORDER_NOT_FOUND: {
          status: 404,
          message: "Pesanan tidak ditemukan",
        },
        USER_NOT_FOUND: {
          status: 400,
          message: "Pengguna kasir tidak ditemukan",
        },
        ORDER_CANNOT_BE_MODIFIED: {
          status: 400,
          message:
            "Pesanan READY, COMPLETED, atau CANCELLED tidak dapat dikoreksi",
        },
        MENU_NOT_AVAILABLE: {
          status: 400,
          message: "Menu tidak ditemukan atau tidak tersedia",
        },
        PAID_ORDER_TOTAL_MISMATCH: {
          status: 400,
          message: "Total pesanan yang sudah dibayar tidak boleh berubah",
        },
      };

      const knownError = errors[error.message];

      if (knownError) {
        res.status(knownError.status).json({
          success: false,
          message: knownError.message,
        });
        return;
      }
    }

    console.error("Gagal mengoreksi pesanan:", error);

    res.status(500).json({
      success: false,
      message: "Gagal mengoreksi pesanan",
    });
  }
});

// GET /api/orders/:id/modifications
router.get(
  "/:id/modifications",
  authenticateToken,
  authorizeRole("ADMIN", "CASHIER"),
  async (req, res) => {
  const orderId = Number(req.params.id);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    res.status(400).json({
      success: false,
      message: "ID pesanan tidak valid",
    });
    return;
  }

  try {
    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      select: { id: true },
    });

    if (!order) {
      res.status(404).json({
        success: false,
        message: "Pesanan tidak ditemukan",
      });
      return;
    }

    const modifications = await prisma.order_modifications.findMany({
      where: { order_id: orderId },
      orderBy: { created_at: "desc" },
    });

    res.status(200).json({
      success: true,
      message: "Riwayat koreksi pesanan berhasil diambil",
      data: modifications,
    });
  } catch (error) {
    console.error("Gagal mengambil riwayat koreksi:", error);

    res.status(500).json({
      success: false,
      message: "Gagal mengambil riwayat koreksi pesanan",
    });
  }
});

export default router;
