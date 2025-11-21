-- AlterTable
ALTER TABLE "users" ADD COLUMN     "backupCodes" TEXT,
ADD COLUMN     "backupCodesAuthTag" TEXT,
ADD COLUMN     "backupCodesIv" TEXT,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpSecret" TEXT,
ADD COLUMN     "totpSecretAuthTag" TEXT,
ADD COLUMN     "totpSecretIv" TEXT,
ADD COLUMN     "totpVerifiedAt" TIMESTAMP(3);
