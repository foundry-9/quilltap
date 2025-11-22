-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "imageProfileId" TEXT;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_imageProfileId_fkey" FOREIGN KEY ("imageProfileId") REFERENCES "image_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
