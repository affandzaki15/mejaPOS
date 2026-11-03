import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

async function main() {
  const email = "admin@mejapos.com";
  const password = "AdminMejaPOS123!";

  const hashedPassword = await bcrypt.hash(password, 12);

  const admin = await prisma.users.upsert({
    where: { email },
    update: {
      password_hash: hashedPassword,
      role: "ADMIN",
    },
    create: {
      name: "Administrator",
      email,
      password_hash: hashedPassword,
      role: "ADMIN",
    },
  });

  console.log("Admin berhasil dibuat:");
  console.log({
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
  });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });