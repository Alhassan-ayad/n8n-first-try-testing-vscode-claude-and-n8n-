-- ─────────────────────────────────────────────────────────────────────────────
-- Simulated mngm core database for local development and end-to-end tests.
-- Mirrors the tables/columns the CDC mappers read (packages/cdc/src/mappings.ts).
-- In production, point SOURCE_MSSQL_URL at the real mngm core DB and run
-- docs/sql/enable-cdc.sql there instead of this file.
-- ─────────────────────────────────────────────────────────────────────────────
IF DB_ID('mngm_core') IS NULL
BEGIN
  CREATE DATABASE mngm_core;
END
GO

USE mngm_core;
GO

IF OBJECT_ID('dbo.Users') IS NULL
CREATE TABLE dbo.Users (
  Id                 NVARCHAR(64)  NOT NULL PRIMARY KEY,
  FullName           NVARCHAR(200) NULL,
  Phone              NVARCHAR(32)  NULL,
  Email              NVARCHAR(256) NULL,
  Language           NVARCHAR(2)   NOT NULL DEFAULT 'ar',
  Source             NVARCHAR(50)  NOT NULL DEFAULT 'organic',
  IsFormerInstalment BIT           NOT NULL DEFAULT 0,
  Status             NVARCHAR(20)  NOT NULL DEFAULT 'active',
  CloseReason        NVARCHAR(200) NULL,
  CreatedAt          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.KycApplications') IS NULL
CREATE TABLE dbo.KycApplications (
  Id              INT IDENTITY(1,1) PRIMARY KEY,
  UserId          NVARCHAR(64)  NOT NULL,
  Status          NVARCHAR(20)  NOT NULL, -- submitted | approved | rejected
  RejectionReason NVARCHAR(400) NULL,
  Attempt         INT           NOT NULL DEFAULT 1,
  CreatedAt       DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt       DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.CashTransactions') IS NULL
CREATE TABLE dbo.CashTransactions (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  UserId    NVARCHAR(64)   NOT NULL,
  Direction NVARCHAR(3)    NOT NULL, -- in | out
  Amount    DECIMAL(18,2)  NOT NULL,
  Method    NVARCHAR(40)   NULL,
  Status    NVARCHAR(20)   NOT NULL, -- pending | settled | requested | executed | failed
  CreatedAt DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.Orders') IS NULL
CREATE TABLE dbo.Orders (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  UserId        NVARCHAR(64)   NOT NULL,
  Side          NVARCHAR(4)    NOT NULL, -- buy | sell
  Metal         NVARCHAR(10)   NOT NULL, -- gold | silver
  Grams         DECIMAL(18,4)  NULL,
  PricePerGram  DECIMAL(18,2)  NULL,
  Amount        DECIMAL(18,2)  NULL,
  Status        NVARCHAR(20)   NOT NULL, -- started | placed | executed | failed | cancelled
  FailureReason NVARCHAR(400)  NULL,
  CreatedAt     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.Conversions') IS NULL
CREATE TABLE dbo.Conversions (
  Id             INT IDENTITY(1,1) PRIMARY KEY,
  UserId         NVARCHAR(64)  NOT NULL,
  Metal          NVARCHAR(10)  NOT NULL,
  Grams          DECIMAL(18,4) NOT NULL,
  Status         NVARCHAR(20)  NOT NULL, -- accepted | ready | dispatched | delivered
  CourierName    NVARCHAR(100) NULL,
  CourierPhone   NVARCHAR(32)  NULL,
  DeliverySlotAt DATETIME2     NULL,
  UpdatedAt      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.Uploads') IS NULL
CREATE TABLE dbo.Uploads (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  UserId    NVARCHAR(64)  NOT NULL,
  Metal     NVARCHAR(10)  NOT NULL,
  Grams     DECIMAL(18,4) NULL,
  Purity    DECIMAL(6,2)  NULL,
  Status    NVARCHAR(20)  NOT NULL, -- received | assayed | credited
  UpdatedAt DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.Gifts') IS NULL
CREATE TABLE dbo.Gifts (
  Id              INT IDENTITY(1,1) PRIMARY KEY,
  SenderUserId    NVARCHAR(64)  NOT NULL,
  SenderName      NVARCHAR(200) NULL,
  RecipientUserId NVARCHAR(64)  NULL,
  RecipientName   NVARCHAR(200) NULL,
  RecipientPhone  NVARCHAR(32)  NULL,
  Metal           NVARCHAR(10)  NOT NULL,
  Grams           DECIMAL(18,4) NOT NULL,
  Status          NVARCHAR(20)  NOT NULL DEFAULT 'sent',
  CreatedAt       DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.RecurringPlans') IS NULL
CREATE TABLE dbo.RecurringPlans (
  Id                INT IDENTITY(1,1) PRIMARY KEY,
  UserId            NVARCHAR(64)  NOT NULL,
  Amount            DECIMAL(18,2) NOT NULL,
  Metal             NVARCHAR(10)  NOT NULL DEFAULT 'gold',
  DayOfMonth        INT           NOT NULL,
  NextDebitDate     DATE          NULL,
  Status            NVARCHAR(20)  NOT NULL DEFAULT 'active', -- active | cancelled
  ConsecutiveMonths INT           NOT NULL DEFAULT 0,
  CreatedAt         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.PlanDebits') IS NULL
CREATE TABLE dbo.PlanDebits (
  Id                INT IDENTITY(1,1) PRIMARY KEY,
  PlanId            INT           NOT NULL,
  UserId            NVARCHAR(64)  NOT NULL,
  Amount            DECIMAL(18,2) NOT NULL,
  Grams             DECIMAL(18,4) NULL,
  Status            NVARCHAR(20)  NOT NULL, -- succeeded | failed
  FailureReason     NVARCHAR(400) NULL,
  AttemptNo         INT           NOT NULL DEFAULT 1,
  ConsecutiveMonths INT           NULL,
  CreatedAt         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.SecurityEvents') IS NULL
CREATE TABLE dbo.SecurityEvents (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  UserId    NVARCHAR(64)  NOT NULL,
  Type      NVARCHAR(40)  NOT NULL, -- new_device | password_changed | bank_changed
  Device    NVARCHAR(200) NULL,
  CreatedAt DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.Logins') IS NULL
CREATE TABLE dbo.Logins (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  UserId    NVARCHAR(64)  NOT NULL,
  Device    NVARCHAR(200) NULL,
  CreatedAt DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.Prices') IS NULL
CREATE TABLE dbo.Prices (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  Metal         NVARCHAR(10)  NOT NULL,
  BuyPrice      DECIMAL(18,2) NULL,
  SellPrice     DECIMAL(18,2) NULL,
  IsStale       BIT           NOT NULL DEFAULT 0,
  TradingPaused BIT           NOT NULL DEFAULT 0,
  CreatedAt     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.OtpRequests') IS NULL
CREATE TABLE dbo.OtpRequests (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  UserId    NVARCHAR(64)  NULL,
  Phone     NVARCHAR(32)  NULL,
  Email     NVARCHAR(256) NULL,
  Code      NVARCHAR(10)  NOT NULL,
  Purpose   NVARCHAR(40)  NULL,
  CreatedAt DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

-- Read-only tables (queried directly, not via CDC)
IF OBJECT_ID('dbo.Holdings') IS NULL
CREATE TABLE dbo.Holdings (
  UserId    NVARCHAR(64)  NOT NULL,
  Metal     NVARCHAR(10)  NOT NULL,
  Grams     DECIMAL(18,4) NOT NULL DEFAULT 0,
  UpdatedAt DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_Holdings PRIMARY KEY (UserId, Metal)
);

IF OBJECT_ID('dbo.Wallets') IS NULL
CREATE TABLE dbo.Wallets (
  UserId      NVARCHAR(64)  NOT NULL PRIMARY KEY,
  CashBalance DECIMAL(18,2) NOT NULL DEFAULT 0
);
GO

-- ── Enable Change Data Capture ──────────────────────────────────────────────
IF (SELECT is_cdc_enabled FROM sys.databases WHERE name = 'mngm_core') = 0
  EXEC sys.sp_cdc_enable_db;
GO

DECLARE @t NVARCHAR(128);
DECLARE c CURSOR FOR
  SELECT name FROM (VALUES ('Users'),('KycApplications'),('CashTransactions'),('Orders'),('Conversions'),('Uploads'),
                           ('Gifts'),('RecurringPlans'),('PlanDebits'),('SecurityEvents'),('Logins'),('Prices'),('OtpRequests')) v(name);
OPEN c;
FETCH NEXT FROM c INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cdc.change_tables WHERE capture_instance = 'dbo_' + @t)
    EXEC sys.sp_cdc_enable_table @source_schema = N'dbo', @source_name = @t, @role_name = NULL, @supports_net_changes = 0;
  FETCH NEXT FROM c INTO @t;
END
CLOSE c;
DEALLOCATE c;
GO

-- Make sure the capture job is running (it is created started; this covers restarts).
-- Check first: Agent reports "already running" to the client, past TRY/CATCH,
-- which fails sqlcmd -b on every re-run.
BEGIN TRY
  IF NOT EXISTS (
    SELECT 1 FROM msdb.dbo.sysjobactivity a
      JOIN msdb.dbo.sysjobs j ON j.job_id = a.job_id
     WHERE j.name = N'cdc.' + DB_NAME() + N'_capture'
       AND a.session_id = (SELECT MAX(session_id) FROM msdb.dbo.syssessions)
       AND a.start_execution_date IS NOT NULL AND a.stop_execution_date IS NULL)
    EXEC sys.sp_cdc_start_job @job_type = N'capture';
END TRY
BEGIN CATCH
  PRINT 'capture job already running';
END CATCH
GO
