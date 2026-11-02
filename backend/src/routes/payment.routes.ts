import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";

const router = Router();

// GET: Menampilkan semua pembayaran
router.get("/", async (_req, res) => {
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
router.post("/", async (req, res) => {
  const paymentSchema = z.object({
    order_id: z.number().int().positive(),
    payment_method: z.enum(["CASH", "QRIS", "DEBIT", "CREDIT"]),
    amount: z.number().positive(),
    confirmed_by: z.number().int().positive(),
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

  const { order_id, payment_method, amount, confirmed_by } = validation.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.orders.findUnique({
        where: { id: order_id },
      });

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
