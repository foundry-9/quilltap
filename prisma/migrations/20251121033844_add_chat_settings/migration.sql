-- CreateEnum
CREATE TYPE "AvatarDisplayMode" AS ENUM ('ALWAYS', 'GROUP_ONLY', 'NEVER');

-- CreateTable
CREATE TABLE "chat_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "avatarDisplayMode" "AvatarDisplayMode" NOT NULL DEFAULT 'ALWAYS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_settings_userId_key" ON "chat_settings"("userId");

-- AddForeignKey
ALTER TABLE "chat_settings" ADD CONSTRAINT "chat_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
