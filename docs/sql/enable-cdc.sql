-- ─────────────────────────────────────────────────────────────────────────────
-- Run on the PRODUCTION mngm core database (DBA). Enables Change Data Capture
-- on the tables the engagement platform reads, and creates a read-only login.
-- Requirements: SQL Server Standard/Enterprise (or Azure SQL MI), SQL Server
-- Agent running. Change table and column names here AND in
-- packages/cdc/src/mappings.ts if the production schema differs.
-- ─────────────────────────────────────────────────────────────────────────────
USE mngm_core;  -- ← production database name
GO

IF (SELECT is_cdc_enabled FROM sys.databases WHERE name = DB_NAME()) = 0
  EXEC sys.sp_cdc_enable_db;
GO

-- Gate CDC reads behind a role so only the platform user can read change tables.
IF DATABASE_PRINCIPAL_ID('cep_cdc_reader') IS NULL CREATE ROLE cep_cdc_reader;
GO

DECLARE @t NVARCHAR(128);
DECLARE c CURSOR FOR
  SELECT name FROM (VALUES ('Users'),('KycApplications'),('CashTransactions'),('Orders'),('Conversions'),('Uploads'),
                           ('Gifts'),('RecurringPlans'),('PlanDebits'),('SecurityEvents'),('Logins'),('Prices'),('OtpRequests')) v(name);
OPEN c;
FETCH NEXT FROM c INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF OBJECT_ID('dbo.' + @t) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM cdc.change_tables WHERE capture_instance = 'dbo_' + @t)
    EXEC sys.sp_cdc_enable_table @source_schema = N'dbo', @source_name = @t, @role_name = N'cep_cdc_reader', @supports_net_changes = 0;
  FETCH NEXT FROM c INTO @t;
END
CLOSE c;
DEALLOCATE c;
GO

-- Keep 3 days of change data (default) — the platform polls every 2 seconds.
-- EXEC sys.sp_cdc_change_job @job_type = N'cleanup', @retention = 4320;

-- Read-only login for the platform (SOURCE_MSSQL_URL).
IF SUSER_ID('cep_reader') IS NULL
  CREATE LOGIN cep_reader WITH PASSWORD = '<<strong password>>', CHECK_POLICY = ON;
GO
IF DATABASE_PRINCIPAL_ID('cep_reader') IS NULL
  CREATE USER cep_reader FOR LOGIN cep_reader;
GO
ALTER ROLE db_datareader ADD MEMBER cep_reader;   -- Users, Holdings, Wallets, RecurringPlans, Orders reads
ALTER ROLE cep_cdc_reader ADD MEMBER cep_reader;  -- change tables
GO

-- Check:
-- SELECT capture_instance, source_object_id FROM cdc.change_tables;
-- EXEC msdb.dbo.sp_help_job @job_name = 'cdc.<db>_capture';
