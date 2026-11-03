import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

async function main() {
  const password = "CashierMejaPOS123!";
  const hashedPassword = await bcrypt.hash(password, 12);

  const cashier = await prisma.users.upsert({
    where: {
      email: "cashier@mejapos.com",
    },
    update: {
      name: "Cashier MejaPOS",
      password_hash: hashedPassword,
      role: "CASHIER",
    },
    create: {
      name: "Cashier MejaPOS",
      email: "cashier@mejapos.com",
      password_hash: hashedPassword,
      role: "CASHIER",
    },
  });

  console.log("Akun CASHIER berhasil dibuat:");
  console.log({
    id: cashier.id,
    name: cashier.name,
    email: cashier.email,
    role: cashier.role,
  });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });