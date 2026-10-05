-- Engagement platform database (Prisma migrations create the tables).
IF DB_ID('mngm_cep') IS NULL
BEGIN
  CREATE DATABASE mngm_cep;
END
GO
