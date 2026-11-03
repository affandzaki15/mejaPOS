
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import {z} from "zod"
import {
  authenticateToken,
  authorizeRole,
} from "../middleware/auth.middleware.js";

const router = Router();

// GET: Menampilkan semua meja
router.get(
  "/",
  authenticateToken,
  authorizeRole("ADMIN", "CASHIER", "KITCHEN"),
  async (_req, res) => {
  try {
    const tables = await prisma.restaurant_tables.findMany({
      orderBy: {
        table_number: "asc",
      },
    });

    res.json({
      success: true,
      data: tables,
    });
  } catch (error) {
    console.error("Failed to fetch tables:", error);

    res.status(500).json({
      success: false,
      message: "Gagal mengambil data meja",
    });
  }
});


// POST: Menambahkan meja baru
router.post("/", authenticateToken, authorizeRole("ADMIN"), async (req, res) => {
  const tableSchema = z.object({
    table_number: z.number().int().positive(),
    is_active: z.boolean().optional(),
  });

  const validation = tableSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({
      success: false,
      message: "Validasi gagal",
      errors: validation.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const table = await prisma.restaurant_tables.create({
      data: {
        table_number: validation.data.table_number,
        is_active: validation.data.is_active ?? true,
      },
    });

    res.status(201).json({
      success: true,
      message: "Meja berhasil ditambahkan",
      data: table,
    });
  } catch (error) {
    console.error("Failed to create table:", error);

    res.status(500).json({
      success: false,
      message: "Gagal menambahkan meja. Nomor meja mungkin sudah digunakan.",
    });
  }
});


// PUT: Memperbarui data meja
router.put(
  "/:id",
  authenticateToken,
  authorizeRole("ADMIN"),
  async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({
      success: false,
      message: "ID meja tidak valid",
    });
    return;
  }

  const tableSchema = z.object({
    table_number: z.number().int().positive(),
    is_active: z.boolean(),
  });

  const validation = tableSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({
      success: false,
      message: "Validasi gagal",
      errors: validation.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const table = await prisma.restaurant_tables.update({
      where: { id },
      data: {
        table_number: validation.data.table_number,
        is_active: validation.data.is_active,
      },
    });

    res.json({
      success: true,
      message: "Meja berhasil diperbarui",
      data: table,
    });
  } catch (error) {
    console.error("Failed to update table:", error);

    res.status(500).json({
      success: false,
      message: "Gagal memperbarui meja. Periksa ID dan nomor meja.",
    });
  }
});


// DELETE: Menghapus meja
router.delete(
  "/:id",
  authenticateToken,
  authorizeRole("ADMIN"),
  async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({
      success: false,
      message: "ID meja tidak valid",
    });
    return;
  }

  try {
    await prisma.restaurant_tables.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: "Meja berhasil dihapus",
    });
  } catch (error) {
    console.error("Failed to delete table:", error);

    res.status(500).json({
      success: false,
      message: "Gagal menghapus meja. Periksa ID meja.",
    });
  }
});


export default router;
