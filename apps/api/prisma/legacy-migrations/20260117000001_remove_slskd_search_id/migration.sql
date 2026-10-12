-- DropIndex
DROP INDEX `slskd_downloads_search_id_idx` ON `slskd_downloads`;

-- AlterTable
ALTER TABLE `slskd_downloads` DROP COLUMN `search_id`;
