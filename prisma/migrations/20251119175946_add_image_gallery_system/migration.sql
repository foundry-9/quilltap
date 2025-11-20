-- CreateEnum
CREATE TYPE "ImageTagType" AS ENUM ('CHARACTER', 'PERSONA', 'CHAT', 'THEME');

-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "url" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_tags" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "tagType" "ImageTagType" NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_avatar_overrides" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_avatar_overrides_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "characters" ADD COLUMN "defaultImageId" TEXT;

-- AlterTable
ALTER TABLE "personas" ADD COLUMN "defaultImageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "image_tags_imageId_tagType_tagId_key" ON "image_tags"("imageId", "tagType", "tagId");

-- CreateIndex
CREATE INDEX "image_tags_tagType_tagId_idx" ON "image_tags"("tagType", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_avatar_overrides_chatId_characterId_key" ON "chat_avatar_overrides"("chatId", "characterId");

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_tags" ADD CONSTRAINT "image_tags_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_defaultImageId_fkey" FOREIGN KEY ("defaultImageId") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personas" ADD CONSTRAINT "personas_defaultImageId_fkey" FOREIGN KEY ("defaultImageId") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_avatar_overrides" ADD CONSTRAINT "chat_avatar_overrides_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_avatar_overrides" ADD CONSTRAINT "chat_avatar_overrides_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_avatar_overrides" ADD CONSTRAINT "chat_avatar_overrides_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
