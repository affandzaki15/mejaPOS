import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const validation = loginSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        success: false,
        message: "Email atau password tidak valid",
        errors: validation.error.flatten(),
      });
      return;
    }

    const { email, password } = validation.data;

    const user = await prisma.users.findUnique({
      where: { email },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: "Email atau password salah",
      });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      res.status(401).json({
        success: false,
        message: "Email atau password salah",
      });
      return;
    }

    const secret = process.env.JWT_SECRET;

    if (!secret) {
      res.status(500).json({
        success: false,
        message: "JWT_SECRET belum dikonfigurasi",
      });
      return;
    }

   const token = jwt.sign(
  {
    id: Number(user.id),
    role: String(user.role),
  },
  secret,
  {
    expiresIn: "1d",
  }
);

    res.status(200).json({
      success: true,
      message: "Login berhasil",
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Terjadi kesalahan pada server",
    });
  }
});

// GET /api/auth/me
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({
      where: {
        id: req.user!.id,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        created_at: true,
      },
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: "User tidak ditemukan",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Data user berhasil diambil",
      data: user,
    });
  } catch (error) {
    console.error("AUTH ME ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Terjadi kesalahan pada server",
    });
  }
});

export default router;
