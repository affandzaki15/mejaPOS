import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool } from "./config/database.js";
import { prisma } from "./lib/prisma.js";
import categoryRoutes from "./routes/category.routes.js";
import menuRoutes from "./routes/menu.routes.js";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use("/api/categories", categoryRoutes);
app.use("/api/menus", menuRoutes);

// Tes backend
app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "MejaPOS API is running",
  });
});

// Tes koneksi PostgreSQL
app.get("/api/health/db", async (_req, res) => {
  try {
    const users = await prisma.users.findMany();

    res.json({
      success: true,
      message: "Prisma connected successfully",
      totalUsers: users.length,
    });
  } catch (error) {
    console.error("Prisma connection failed:", error);

    res.status(500).json({
      success: false,
      message: "Prisma connection failed",
    });
  }
});

app.listen(PORT, () => {
  console.log(`MejaPOS API running at http://localhost:${PORT}`);
});

console.log(
  "DB password loaded:",
  Boolean(process.env.DB_PASSWORD),
);
