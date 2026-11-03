import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

interface JwtPayload {
  id: number;
  role: string;
}

export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!JWT_SECRET) {
    res.status(500).json({
      success: false,
      message: "JWT_SECRET belum dikonfigurasi",
    });
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : undefined;

  if (!token) {
    res.status(401).json({
      success: false,
      message: "Token tidak ditemukan",
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;

    if (
      typeof decoded.id !== "number" ||
      typeof decoded.role !== "string"
    ) {
      res.status(401).json({
        success: false,
        message: "Token tidak valid",
      });
      return;
    }

    req.user = {
      id: decoded.id,
      role: decoded.role,
    };

    next();
  } catch {
    res.status(401).json({
      success: false,
      message: "Token tidak valid atau kedaluwarsa",
    });
  }
};

export const authorizeRole = (...allowedRoles: string[]) => {
  return (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Silakan login terlebih dahulu",
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: "Kamu tidak memiliki akses",
      });
      return;
    }

    next();
  };
};