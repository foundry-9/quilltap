-- CreateEnum
CREATE TYPE "ImageProvider" AS ENUM ('OPENAI', 'GROK', 'GOOGLE_IMAGEN');

-- CreateTable
CREATE TABLE "image_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "ImageProvider" NOT NULL,
    "apiKeyId" TEXT,
    "baseUrl" TEXT,
    "modelName" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "image_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_profile_tags" (
    "id" TEXT NOT NULL,
    "imageProfileId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_profile_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "image_profiles_userId_isDefault_idx" ON "image_profiles"("userId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "image_profiles_userId_name_key" ON "image_profiles"("userId", "name");

-- CreateIndex
CREATE INDEX "image_profile_tags_tagId_idx" ON "image_profile_tags"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "image_profile_tags_imageProfileId_tagId_key" ON "image_profile_tags"("imageProfileId", "tagId");

-- AddForeignKey
ALTER TABLE "image_profiles" ADD CONSTRAINT "image_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_profiles" ADD CONSTRAINT "image_profiles_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_profile_tags" ADD CONSTRAINT "image_profile_tags_imageProfileId_fkey" FOREIGN KEY ("imageProfileId") REFERENCES "image_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_profile_tags" ADD CONSTRAINT "image_profile_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
