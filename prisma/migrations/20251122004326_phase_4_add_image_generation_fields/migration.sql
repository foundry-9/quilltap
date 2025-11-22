-- AlterTable
ALTER TABLE "images" ADD COLUMN     "generationModel" TEXT,
ADD COLUMN     "generationPrompt" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'upload';

-- CreateTable
CREATE TABLE "chat_files" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" TEXT,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sentToProvider" BOOLEAN NOT NULL DEFAULT false,
    "providerError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_files_chatId_idx" ON "chat_files"("chatId");

-- CreateIndex
CREATE INDEX "chat_files_messageId_idx" ON "chat_files"("messageId");

-- AddForeignKey
ALTER TABLE "chat_files" ADD CONSTRAINT "chat_files_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_files" ADD CONSTRAINT "chat_files_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
