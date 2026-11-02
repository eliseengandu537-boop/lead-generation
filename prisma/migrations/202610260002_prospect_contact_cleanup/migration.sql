-- DropForeignKey
ALTER TABLE "Prospect" DROP CONSTRAINT "Prospect_workspaceId_contactId_fkey";

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_workspaceId_contactId_fkey" FOREIGN KEY ("workspaceId", "contactId") REFERENCES "Contact"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
