import { hash } from "bcryptjs";
import { z } from "zod";
import { db } from "../src/lib/db";
async function main() {
  const email = z
    .email()
    .parse(process.env.BOOTSTRAP_ADMIN_EMAIL)
    .toLowerCase();
  const password = z
    .string()
    .min(16)
    .max(128)
    .parse(process.env.BOOTSTRAP_ADMIN_PASSWORD);
  if (await db.user.findUnique({ where: { email } }))
    throw new Error(
      "That account already exists. Bootstrap never changes or promotes existing users.",
    );
  await db.user.create({
    data: {
      email,
      name: "Agency administrator",
      passwordHash: await hash(password, 12),
      agencyAdmin: true,
    },
  });
  console.log(
    "Agency administrator created. Remove bootstrap credentials from the environment.",
  );
}
main()
  .catch((e) => {
    console.error(
      e instanceof Error ? e.message : "Unable to create administrator",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
