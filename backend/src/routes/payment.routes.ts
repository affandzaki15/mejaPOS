import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import {
  authenticateToken,
  authorizeRole,
} from "../middleware/auth.middleware.js";

const router = Router();

// GET: Menampilkan semua pembayaran
router.get(
  "/",
  authenticateToken,
  authorizeRole("ADMIN", "CASHIER"),
  async (_req, res) => {
  try {
    const payments = await prisma.payments.findMany({
      include: {
        orders: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    res.json({
      success: true,
      total: payments.length,
      data: payments,
    });
  } catch (error) {
    console.error("Failed to fetch payments:", error);

    res.status(500).json({
      success: false,
      message: "Gagal mengambil data pembayaran",
    });
  }
});

// POST: Memproses pembayaran pesanan
router.post(
  "/",
  authenticateToken,
  authorizeRole("ADMIN", "CASHIER"),
  async (req, res) => {
  const paymentSchema = z.object({
  order_id: z.number().int().positive(),
  payment_method: z.enum(["CASH", "QRIS", "DEBIT", "CREDIT"]),
  amount: z.number().positive(),
});

  const validation = paymentSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({
      success: false,
      message: "Validasi pembayaran gagal",
      errors: validation.error.flatten().fieldErrors,
    });
    return;
  }

  const { order_id, payment_method, amount} = validation.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Kunci baris pesanan sampai transaksi selesai.
      // Request pembayaran lain untuk pesanan yang sama harus menunggu.
      const orders = await tx.$queryRaw<
        Array<{
          id: number;
          payment_status: string;
          order_status: string;
          total_amount: unknown;
        }>
      >`
    SELECT id, payment_status, order_status, total_amount
    FROM orders
    WHERE id = ${order_id}
    FOR UPDATE
  `;

      const order = orders[0];

      if (!order) {
        throw new Error("ORDER_NOT_FOUND");
      }

      if (order.payment_status !== "UNPAID") {
        throw new Error("ORDER_ALREADY_PAID");
      }

      if (order.order_status === "CANCELLED") {
        throw new Error("ORDER_CANCELLED");
      }

      if (Number(order.total_amount) !== amount) {
        throw new Error("AMOUNT_MISMATCH");
      }

      const confirmed_by = req.user!.id;

      const payment = await tx.payments.create({
        data: {
          order_id,
          payment_method,
          amount,
          payment_status: "PAID",
          confirmed_by,
          paid_at: new Date(),
        },
      });

      const updatedOrder = await tx.orders.update({
        where: { id: order_id },
        data: {
          payment_status: "PAID",
          order_status: "NEW",
        },
      });
      await tx.order_status_history.create({
        data: {
          order_id,
          previous_status: order.order_status,
          new_status: "NEW",
          changed_by: confirmed_by,
          notes: "Status berubah otomatis setelah pembayaran berhasil",
        },
      });

      return { payment, order: updatedOrder };
    });

    res.status(201).json({
      success: true,
      message: "Pembayaran berhasil dikonfirmasi",
      data: result,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "ORDER_NOT_FOUND") {
        res.status(404).json({
          success: false,
          message: "Pesanan tidak ditemukan",
        });
        return;
      }

      if (error.message === "ORDER_ALREADY_PAID") {
        res.status(409).json({
          success: false,
          message: "Pesanan sudah dibayar",
        });
        return;
      }

      if (error.message === "AMOUNT_MISMATCH") {
        res.status(400).json({
          success: false,
          message: "Nominal pembayaran tidak sesuai total pesanan",
        });
        return;
      }
    }

    console.error("Failed to process payment:", error);

    if (error instanceof Error && error.message === "ORDER_CANCELLED") {
      res.status(400).json({
        success: false,
        message: "Pesanan yang dibatalkan tidak dapat dibayar",
      });
      return;
    }
    res.status(500).json({
      success: false,
      message: "Gagal memproses pembayaran",
    });
  }
});

export default router;
