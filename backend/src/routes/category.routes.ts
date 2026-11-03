import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import {
  authenticateToken,
  authorizeRole,
} from "../middleware/auth.middleware.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const categories = await prisma.categories.findMany({
      orderBy: {
        name: "asc",
      },
    });

    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error("Failed to fetch categories:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
    });
  }
});

const categorySchema = z.object({
  name: z.string().trim().min(1, "Nama kategori wajib diisi").max(100),
  description: z.string().trim().optional(),
});

router.post(
  "/",
  authenticateToken,
  authorizeRole("ADMIN"),
  async (req, res) => {
  const validation = categorySchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({
      success: false,
      message: "Validasi gagal",
      errors: validation.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const category = await prisma.categories.create({
      data: {
        name: validation.data.name,
        description: validation.data.description || null,
      },
    });

    res.status(201).json({
      success: true,
      message: "Kategori berhasil dibuat",
      data: category,
    });
  } catch (error) {
    console.error("Failed to create category:", error);

    res.status(500).json({
      success: false,
      message: "Gagal membuat kategori. Pastikan nama belum digunakan.",
    });
  }
});

router.put(
  "/:id",
  authenticateToken,
  authorizeRole("ADMIN"),
  async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({
      success: false,
      message: "ID kategori tidak valid",
    });
    return;
  }

  const validation = categorySchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({
      success: false,
      message: "Validasi gagal",
      errors: validation.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const category = await prisma.categories.update({
      where: { id },
      data: {
        name: validation.data.name,
        description: validation.data.description || null,
      },
    });

    res.json({
      success: true,
      message: "Kategori berhasil diperbarui",
      data: category,
    });
  } catch (error) {
    console.error("Failed to update category:", error);

    res.status(404).json({
      success: false,
      message: "Kategori tidak ditemukan atau nama sudah digunakan",
    });
  }
});

router.delete(
  "/:id",
  authenticateToken,
  authorizeRole("ADMIN"),
  async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({
      success: false,
      message: "ID kategori tidak valid",
    });
    return;
  }

  try {
    await prisma.categories.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: "Kategori berhasil dihapus",
    });
  } catch (error) {
    console.error("Failed to delete category:", error);

    res.status(404).json({
      success: false,
      message: "Kategori tidak ditemukan atau masih digunakan menu",
    });
  }
});

export default router;