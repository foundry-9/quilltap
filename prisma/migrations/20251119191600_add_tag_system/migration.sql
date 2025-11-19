-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameLower" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_tags" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persona_tags" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "persona_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_tags" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_profile_tags" (
    "id" TEXT NOT NULL,
    "connectionProfileId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connection_profile_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tags_userId_nameLower_idx" ON "tags"("userId", "nameLower");

-- CreateIndex
CREATE UNIQUE INDEX "tags_userId_nameLower_key" ON "tags"("userId", "nameLower");

-- CreateIndex
CREATE INDEX "character_tags_tagId_idx" ON "character_tags"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "character_tags_characterId_tagId_key" ON "character_tags"("characterId", "tagId");

-- CreateIndex
CREATE INDEX "persona_tags_tagId_idx" ON "persona_tags"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "persona_tags_personaId_tagId_key" ON "persona_tags"("personaId", "tagId");

-- CreateIndex
CREATE INDEX "chat_tags_tagId_idx" ON "chat_tags"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_tags_chatId_tagId_key" ON "chat_tags"("chatId", "tagId");

-- CreateIndex
CREATE INDEX "connection_profile_tags_tagId_idx" ON "connection_profile_tags"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "connection_profile_tags_connectionProfileId_tagId_key" ON "connection_profile_tags"("connectionProfileId", "tagId");

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_tags" ADD CONSTRAINT "character_tags_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_tags" ADD CONSTRAINT "character_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_tags" ADD CONSTRAINT "persona_tags_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_tags" ADD CONSTRAINT "persona_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_tags" ADD CONSTRAINT "chat_tags_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_tags" ADD CONSTRAINT "chat_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_profile_tags" ADD CONSTRAINT "connection_profile_tags_connectionProfileId_fkey" FOREIGN KEY ("connectionProfileId") REFERENCES "connection_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_profile_tags" ADD CONSTRAINT "connection_profile_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
