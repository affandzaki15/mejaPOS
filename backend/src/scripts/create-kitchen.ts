import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

async function main() {
  const password = "KitchenMejaPOS123!";
  const hashedPassword = await bcrypt.hash(password, 12);

  const kitchen = await prisma.users.upsert({
    where: {
      email: "kitchen@mejapos.com",
    },
    update: {
      name: "Kitchen MejaPOS",
      password_hash: hashedPassword,
      role: "KITCHEN",
    },
    create: {
      name: "Kitchen MejaPOS",
      email: "kitchen@mejapos.com",
      password_hash: hashedPassword,
      role: "KITCHEN",
    },
  });

  console.log("Akun KITCHEN berhasil dibuat:", {
    id: kitchen.id,
    name: kitchen.name,
    email: kitchen.email,
    role: kitchen.role,
  });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });