-- CreateTable
CREATE TABLE `IsOnWhatsappJid` (
    `jid` VARCHAR(100) NOT NULL,
    `remoteJid` VARCHAR(100) NOT NULL,
    `lid` VARCHAR(100) NULL,
    `updatedAt` TIMESTAMP NOT NULL,

    INDEX `IsOnWhatsappJid_remoteJid_idx`(`remoteJid`),
    PRIMARY KEY (`jid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
