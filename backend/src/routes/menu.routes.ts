import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client.js";

const router = Router();

const menuSchema = z.object({
  category_id: z.number().int().positive(),
  name: z.string().trim().min(1, "Nama menu wajib diisi").max(150),
  description: z.string().trim().optional(),
  price: z.number().nonnegative(),
  is_available: z.boolean().optional(),
});

router.get("/", async (_req, res) => {
  try {
    const menus = await prisma.menu_items.findMany({
      include: {
        categories: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    res.json({
      success: true,
      data: menus,
    });
  } catch (error) {
    console.error("Failed to fetch menus:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch menus",
    });
  }
});

router.post("/", async (req, res) => {
  const validation = menuSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({
      success: false,
      message: "Validasi gagal",
      errors: validation.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const menu = await prisma.menu_items.create({
      data: {
        category_id: validation.data.category_id,
        name: validation.data.name,
        description: validation.data.description || null,
        price: validation.data.price,
        is_available: validation.data.is_available ?? true,
      },
    });

    res.status(201).json({
      success: true,
      message: "Menu berhasil dibuat",
      data: menu,
    });
  } catch (error) {
    console.error("Failed to create menu:", error);

    res.status(500).json({
      success: false,
      message: "Gagal membuat menu. Periksa kategori yang dipilih.",
    });
  }
});
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({
      success: false,
      message: "ID menu tidak valid",
    });
    return;
  }

  const validation = menuSchema.safeParse(req.body);

  if (!validation.success) {
    res.status(400).json({
      success: false,
      message: "Validasi gagal",
      errors: validation.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const menu = await prisma.menu_items.update({
      where: { id },
      data: {
        category_id: validation.data.category_id,
        name: validation.data.name,
        description: validation.data.description || null,
        price: validation.data.price,
        is_available: validation.data.is_available ?? true,
      },
    });

    res.json({
      success: true,
      message: "Menu berhasil diperbarui",
      data: menu,
    });
  } catch (error) {
    console.error("Failed to update menu:", error);

    res.status(500).json({
      success: false,
      message: "Gagal memperbarui menu. Periksa ID menu dan kategori.",
    });
  }
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);

  // Validasi ID
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({
      success: false,
      message: "ID menu tidak valid",
    });
    return;
  }

  try {
    await prisma.menu_items.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: "Menu berhasil dihapus",
    });
  } catch (error) {
    console.error("Failed to delete menu:", error);

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      res.status(404).json({
        success: false,
        message: "Menu tidak ditemukan",
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: "Terjadi kesalahan pada server",
    });
  }
});

export default router;
