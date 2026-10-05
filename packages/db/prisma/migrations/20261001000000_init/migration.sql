BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[Client] (
    [id] NVARCHAR(1000) NOT NULL,
    [externalId] NVARCHAR(1000) NOT NULL,
    [fullName] NVARCHAR(1000),
    [phone] NVARCHAR(1000),
    [email] NVARCHAR(1000),
    [language] NVARCHAR(1000) NOT NULL CONSTRAINT [Client_language_df] DEFAULT 'ar',
    [lifecycleStage] NVARCHAR(1000) NOT NULL CONSTRAINT [Client_lifecycleStage_df] DEFAULT 'S1',
    [valueTier] NVARCHAR(1000) NOT NULL CONSTRAINT [Client_valueTier_df] DEFAULT 'entry',
    [tags] NVARCHAR(2000) NOT NULL CONSTRAINT [Client_tags_df] DEFAULT '',
    [source] NVARCHAR(1000) NOT NULL CONSTRAINT [Client_source_df] DEFAULT 'organic',
    [kycStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [Client_kycStatus_df] DEFAULT 'none',
    [kycRejectCount] INT NOT NULL CONSTRAINT [Client_kycRejectCount_df] DEFAULT 0,
    [orderCount] INT NOT NULL CONSTRAINT [Client_orderCount_df] DEFAULT 0,
    [avgOrderAmount] FLOAT(53) NOT NULL CONSTRAINT [Client_avgOrderAmount_df] DEFAULT 0,
    [goldGrams] FLOAT(53) NOT NULL CONSTRAINT [Client_goldGrams_df] DEFAULT 0,
    [silverGrams] FLOAT(53) NOT NULL CONSTRAINT [Client_silverGrams_df] DEFAULT 0,
    [holdingValueEgp] FLOAT(53) NOT NULL CONSTRAINT [Client_holdingValueEgp_df] DEFAULT 0,
    [cashBalanceEgp] FLOAT(53) NOT NULL CONSTRAINT [Client_cashBalanceEgp_df] DEFAULT 0,
    [hasRecurringPlan] BIT NOT NULL CONSTRAINT [Client_hasRecurringPlan_df] DEFAULT 0,
    [registeredAt] DATETIME2 NOT NULL CONSTRAINT [Client_registeredAt_df] DEFAULT CURRENT_TIMESTAMP,
    [activatedAt] DATETIME2,
    [firstOrderAt] DATETIME2,
    [lastOrderAt] DATETIME2,
    [lastLoginAt] DATETIME2,
    [closedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Client_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Client_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Client_externalId_key] UNIQUE NONCLUSTERED ([externalId])
);

-- CreateTable
CREATE TABLE [dbo].[Device] (
    [id] NVARCHAR(1000) NOT NULL,
    [clientId] NVARCHAR(1000) NOT NULL,
    [token] NVARCHAR(450) NOT NULL,
    [platform] NVARCHAR(1000) NOT NULL CONSTRAINT [Device_platform_df] DEFAULT 'android',
    [appVersion] NVARCHAR(1000),
    [lastSeenAt] DATETIME2 NOT NULL CONSTRAINT [Device_lastSeenAt_df] DEFAULT CURRENT_TIMESTAMP,
    [invalidatedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Device_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Device_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Device_token_key] UNIQUE NONCLUSTERED ([token])
);

-- CreateTable
CREATE TABLE [dbo].[Consent] (
    [id] NVARCHAR(1000) NOT NULL,
    [clientId] NVARCHAR(1000) NOT NULL,
    [channel] NVARCHAR(1000) NOT NULL,
    [topic] NVARCHAR(1000) NOT NULL,
    [granted] BIT NOT NULL,
    [source] NVARCHAR(1000) NOT NULL,
    [wordingVersion] NVARCHAR(1000),
    [updatedAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Consent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Consent_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Consent_clientId_channel_topic_key] UNIQUE NONCLUSTERED ([clientId],[channel],[topic])
);

-- CreateTable
CREATE TABLE [dbo].[ConsentAudit] (
    [id] NVARCHAR(1000) NOT NULL,
    [clientId] NVARCHAR(1000) NOT NULL,
    [channel] NVARCHAR(1000) NOT NULL,
    [topic] NVARCHAR(1000) NOT NULL,
    [granted] BIT NOT NULL,
    [source] NVARCHAR(1000) NOT NULL,
    [wordingVersion] NVARCHAR(1000),
    [wordingText] NVARCHAR(max),
    [ip] NVARCHAR(1000),
    [actor] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ConsentAudit_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ConsentAudit_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Suppression] (
    [id] NVARCHAR(1000) NOT NULL,
    [channel] NVARCHAR(1000) NOT NULL,
    [value] NVARCHAR(450) NOT NULL,
    [scope] NVARCHAR(1000) NOT NULL CONSTRAINT [Suppression_scope_df] DEFAULT 'marketing',
    [reason] NVARCHAR(1000) NOT NULL,
    [source] NVARCHAR(1000),
    [clientId] NVARCHAR(1000),
    [note] NVARCHAR(1000),
    [expiresAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Suppression_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Suppression_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Suppression_channel_value_scope_key] UNIQUE NONCLUSTERED ([channel],[value],[scope])
);

-- CreateTable
CREATE TABLE [dbo].[PriceAlert] (
    [id] NVARCHAR(1000) NOT NULL,
    [clientId] NVARCHAR(1000) NOT NULL,
    [metal] NVARCHAR(1000) NOT NULL,
    [direction] NVARCHAR(1000) NOT NULL,
    [level] FLOAT(53) NOT NULL,
    [repeat] BIT NOT NULL CONSTRAINT [PriceAlert_repeat_df] DEFAULT 0,
    [active] BIT NOT NULL CONSTRAINT [PriceAlert_active_df] DEFAULT 1,
    [smsAlso] BIT NOT NULL CONSTRAINT [PriceAlert_smsAlso_df] DEFAULT 0,
    [windowStart] NVARCHAR(1000),
    [windowEnd] NVARCHAR(1000),
    [lastTriggeredAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PriceAlert_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PriceAlert_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Template] (
    [id] NVARCHAR(1000) NOT NULL,
    [key] NVARCHAR(1000) NOT NULL,
    [channel] NVARCHAR(1000) NOT NULL,
    [language] NVARCHAR(1000) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [Template_version_df] DEFAULT 1,
    [category] NVARCHAR(1000) NOT NULL,
    [topic] NVARCHAR(1000) NOT NULL,
    [subject] NVARCHAR(500),
    [title] NVARCHAR(500),
    [body] NVARCHAR(max) NOT NULL,
    [html] NVARCHAR(max),
    [deepLink] NVARCHAR(1000),
    [imageUrl] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [Template_status_df] DEFAULT 'draft',
    [lintReport] NVARCHAR(max),
    [owner] NVARCHAR(1000),
    [submittedBy] NVARCHAR(1000),
    [reviewedBy] NVARCHAR(1000),
    [reviewNote] NVARCHAR(2000),
    [approvedBy] NVARCHAR(1000),
    [approvedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Template_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Template_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Template_key_channel_language_version_key] UNIQUE NONCLUSTERED ([key],[channel],[language],[version])
);

-- CreateTable
CREATE TABLE [dbo].[Message] (
    [id] NVARCHAR(1000) NOT NULL,
    [clientId] NVARCHAR(1000),
    [dedupeKey] NVARCHAR(450) NOT NULL,
    [templateKey] NVARCHAR(1000) NOT NULL,
    [templateId] NVARCHAR(1000),
    [channel] NVARCHAR(1000) NOT NULL,
    [category] NVARCHAR(1000) NOT NULL,
    [topic] NVARCHAR(1000) NOT NULL,
    [kind] NVARCHAR(1000) NOT NULL,
    [priority] INT NOT NULL,
    [capped] BIT NOT NULL CONSTRAINT [Message_capped_df] DEFAULT 0,
    [pushTwin] BIT NOT NULL CONSTRAINT [Message_pushTwin_df] DEFAULT 0,
    [language] NVARCHAR(1000) NOT NULL CONSTRAINT [Message_language_df] DEFAULT 'ar',
    [toAddress] NVARCHAR(1000),
    [subject] NVARCHAR(500),
    [title] NVARCHAR(500),
    [body] NVARCHAR(max) NOT NULL,
    [html] NVARCHAR(max),
    [deepLink] NVARCHAR(1000),
    [imageUrl] NVARCHAR(1000),
    [attachments] NVARCHAR(max),
    [vars] NVARCHAR(max),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [Message_status_df] DEFAULT 'pending',
    [statusReason] NVARCHAR(1000),
    [releaseAt] DATETIME2,
    [notBefore] DATETIME2,
    [guardKey] NVARCHAR(450),
    [campaignId] NVARCHAR(1000),
    [campaignSlot] NVARCHAR(1000),
    [journeyEnrollmentId] NVARCHAR(1000),
    [journeyStepId] NVARCHAR(1000),
    [provider] NVARCHAR(1000),
    [providerMessageId] NVARCHAR(450),
    [attempts] INT NOT NULL CONSTRAINT [Message_attempts_df] DEFAULT 0,
    [sentAt] DATETIME2,
    [deliveredAt] DATETIME2,
    [openedAt] DATETIME2,
    [clickedAt] DATETIME2,
    [failedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Message_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Message_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Message_dedupeKey_key] UNIQUE NONCLUSTERED ([dedupeKey])
);

-- CreateTable
CREATE TABLE [dbo].[DeliveryEvent] (
    [id] NVARCHAR(1000) NOT NULL,
    [messageId] NVARCHAR(1000),
    [provider] NVARCHAR(1000) NOT NULL,
    [event] NVARCHAR(1000) NOT NULL,
    [payload] NVARCHAR(max),
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [DeliveryEvent_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DeliveryEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[InboxItem] (
    [id] NVARCHAR(1000) NOT NULL,
    [clientId] NVARCHAR(1000) NOT NULL,
    [messageId] NVARCHAR(1000),
    [category] NVARCHAR(1000) NOT NULL,
    [title] NVARCHAR(500) NOT NULL,
    [body] NVARCHAR(max) NOT NULL,
    [deepLink] NVARCHAR(1000),
    [imageUrl] NVARCHAR(1000),
    [readAt] DATETIME2,
    [expiresAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [InboxItem_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [InboxItem_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Banner] (
    [id] NVARCHAR(1000) NOT NULL,
    [kind] NVARCHAR(1000) NOT NULL CONSTRAINT [Banner_kind_df] DEFAULT 'info',
    [titleEn] NVARCHAR(500) NOT NULL,
    [titleAr] NVARCHAR(500) NOT NULL,
    [bodyEn] NVARCHAR(2000) NOT NULL,
    [bodyAr] NVARCHAR(2000) NOT NULL,
    [deepLink] NVARCHAR(1000),
    [segment] NVARCHAR(max),
    [startsAt] DATETIME2 NOT NULL,
    [endsAt] DATETIME2 NOT NULL,
    [active] BIT NOT NULL CONSTRAINT [Banner_active_df] DEFAULT 1,
    [createdBy] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Banner_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Banner_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[EventLog] (
    [id] NVARCHAR(1000) NOT NULL,
    [eventId] NVARCHAR(450) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [clientExternalId] NVARCHAR(1000),
    [payload] NVARCHAR(max),
    [source] NVARCHAR(1000) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL,
    [processedAt] DATETIME2,
    [error] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EventLog_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [EventLog_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [EventLog_eventId_key] UNIQUE NONCLUSTERED ([eventId])
);

-- CreateTable
CREATE TABLE [dbo].[CdcCheckpoint] (
    [captureInstance] NVARCHAR(1000) NOT NULL,
    [lastLsn] NVARCHAR(1000) NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CdcCheckpoint_pkey] PRIMARY KEY CLUSTERED ([captureInstance])
);

-- CreateTable
CREATE TABLE [dbo].[PriceTick] (
    [id] NVARCHAR(1000) NOT NULL,
    [metal] NVARCHAR(1000) NOT NULL,
    [buyPrice] FLOAT(53) NOT NULL,
    [sellPrice] FLOAT(53) NOT NULL,
    [stale] BIT NOT NULL CONSTRAINT [PriceTick_stale_df] DEFAULT 0,
    [occurredAt] DATETIME2 NOT NULL,
    CONSTRAINT [PriceTick_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DailyMarker] (
    [id] NVARCHAR(1000) NOT NULL,
    [key] NVARCHAR(450) NOT NULL,
    [day] NVARCHAR(1000) NOT NULL,
    [count] INT NOT NULL CONSTRAINT [DailyMarker_count_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DailyMarker_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DailyMarker_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [DailyMarker_key_day_key] UNIQUE NONCLUSTERED ([key],[day])
);

-- CreateTable
CREATE TABLE [dbo].[Journey] (
    [key] NVARCHAR(1000) NOT NULL,
    [enabled] BIT NOT NULL CONSTRAINT [Journey_enabled_df] DEFAULT 1,
    [updatedBy] NVARCHAR(1000),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Journey_pkey] PRIMARY KEY CLUSTERED ([key])
);

-- CreateTable
CREATE TABLE [dbo].[JourneyEnrollment] (
    [id] NVARCHAR(1000) NOT NULL,
    [journeyKey] NVARCHAR(1000) NOT NULL,
    [clientId] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [JourneyEnrollment_status_df] DEFAULT 'active',
    [holdout] BIT NOT NULL CONSTRAINT [JourneyEnrollment_holdout_df] DEFAULT 0,
    [enteredAt] DATETIME2 NOT NULL CONSTRAINT [JourneyEnrollment_enteredAt_df] DEFAULT CURRENT_TIMESTAMP,
    [exitedAt] DATETIME2,
    [exitReason] NVARCHAR(1000),
    [convertedAt] DATETIME2,
    [context] NVARCHAR(max),
    CONSTRAINT [JourneyEnrollment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[JourneyStepRun] (
    [id] NVARCHAR(1000) NOT NULL,
    [enrollmentId] NVARCHAR(1000) NOT NULL,
    [stepId] NVARCHAR(1000) NOT NULL,
    [fireAt] DATETIME2 NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [JourneyStepRun_status_df] DEFAULT 'scheduled',
    [result] NVARCHAR(2000),
    [executedAt] DATETIME2,
    CONSTRAINT [JourneyStepRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Segment] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(2000),
    [filter] NVARCHAR(max) NOT NULL,
    [lastCount] INT,
    [createdBy] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Segment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Segment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Campaign] (
    [id] NVARCHAR(1000) NOT NULL,
    [code] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [objective] NVARCHAR(1000) NOT NULL,
    [hypothesis] NVARCHAR(2000),
    [segmentId] NVARCHAR(1000),
    [segmentFilter] NVARCHAR(max) NOT NULL,
    [segmentSize] INT,
    [holdoutPct] INT NOT NULL CONSTRAINT [Campaign_holdoutPct_df] DEFAULT 10,
    [holdoutSize] INT,
    [channels] NVARCHAR(1000) NOT NULL,
    [templateKey] NVARCHAR(1000) NOT NULL,
    [topic] NVARCHAR(1000) NOT NULL,
    [kind] NVARCHAR(1000) NOT NULL CONSTRAINT [Campaign_kind_df] DEFAULT 'promotion',
    [offerId] NVARCHAR(1000),
    [sendDate] NVARCHAR(1000),
    [slot] NVARCHAR(1000),
    [scheduledAt] DATETIME2,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [Campaign_status_df] DEFAULT 'draft',
    [complianceReviewer] NVARCHAR(1000),
    [complianceNote] NVARCHAR(2000),
    [approver] NVARCHAR(1000),
    [approvedAt] DATETIME2,
    [launchedAt] DATETIME2,
    [completedAt] DATETIME2,
    [goalEvent] NVARCHAR(1000) NOT NULL CONSTRAINT [Campaign_goalEvent_df] DEFAULT 'order.executed',
    [attributionDays] INT NOT NULL CONSTRAINT [Campaign_attributionDays_df] DEFAULT 7,
    [result] NVARCHAR(max),
    [decision] NVARCHAR(1000),
    [decisionNote] NVARCHAR(2000),
    [createdBy] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Campaign_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Campaign_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Campaign_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[Offer] (
    [id] NVARCHAR(1000) NOT NULL,
    [code] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [mechanic] NVARCHAR(1000) NOT NULL,
    [eligibility] NVARCHAR(max) NOT NULL,
    [exclusions] NVARCHAR(max),
    [hypothesis] NVARCHAR(2000),
    [costPerRedemption] FLOAT(53) NOT NULL,
    [expectedRedemption] FLOAT(53) NOT NULL,
    [eligibleCount] INT NOT NULL CONSTRAINT [Offer_eligibleCount_df] DEFAULT 0,
    [worstCaseCost] FLOAT(53) NOT NULL,
    [actualRedemptions] INT,
    [actualCost] FLOAT(53),
    [isNewMechanic] BIT NOT NULL CONSTRAINT [Offer_isNewMechanic_df] DEFAULT 0,
    [touchesPricing] BIT NOT NULL CONSTRAINT [Offer_touchesPricing_df] DEFAULT 0,
    [metalDenominated] BIT NOT NULL CONSTRAINT [Offer_metalDenominated_df] DEFAULT 1,
    [hedgeReference] NVARCHAR(1000),
    [holdoutPct] INT NOT NULL CONSTRAINT [Offer_holdoutPct_df] DEFAULT 10,
    [startDate] DATETIME2,
    [endDate] DATETIME2,
    [termsUrlEn] NVARCHAR(1000),
    [termsUrlAr] NVARCHAR(1000),
    [helpCentreUrl] NVARCHAR(1000),
    [approvalTier] NVARCHAR(1000),
    [requiredApprovals] NVARCHAR(1000),
    [complianceLevel] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [Offer_status_df] DEFAULT 'draft',
    [reviewDueAt] DATETIME2,
    [result] NVARCHAR(max),
    [decision] NVARCHAR(1000),
    [createdBy] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Offer_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Offer_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Offer_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[OfferApproval] (
    [id] NVARCHAR(1000) NOT NULL,
    [offerId] NVARCHAR(1000) NOT NULL,
    [role] NVARCHAR(1000) NOT NULL,
    [approver] NVARCHAR(1000) NOT NULL,
    [decision] NVARCHAR(1000) NOT NULL,
    [note] NVARCHAR(2000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [OfferApproval_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [OfferApproval_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [OfferApproval_offerId_role_key] UNIQUE NONCLUSTERED ([offerId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[HoldoutAssignment] (
    [id] NVARCHAR(1000) NOT NULL,
    [scope] NVARCHAR(1000) NOT NULL,
    [clientId] NVARCHAR(1000) NOT NULL,
    [holdout] BIT NOT NULL,
    [assignedAt] DATETIME2 NOT NULL CONSTRAINT [HoldoutAssignment_assignedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [convertedAt] DATETIME2,
    CONSTRAINT [HoldoutAssignment_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [HoldoutAssignment_scope_clientId_key] UNIQUE NONCLUSTERED ([scope],[clientId])
);

-- CreateTable
CREATE TABLE [dbo].[CallTask] (
    [id] NVARCHAR(1000) NOT NULL,
    [clientId] NVARCHAR(1000) NOT NULL,
    [reason] NVARCHAR(1000) NOT NULL,
    [journeyKey] NVARCHAR(1000),
    [priority] INT NOT NULL CONSTRAINT [CallTask_priority_df] DEFAULT 5,
    [dueAt] DATETIME2 NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [CallTask_status_df] DEFAULT 'open',
    [outcome] NVARCHAR(1000),
    [notes] NVARCHAR(2000),
    [assignedTo] NVARCHAR(1000),
    [completedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CallTask_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [CallTask_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[SurveyResponse] (
    [id] NVARCHAR(1000) NOT NULL,
    [clientId] NVARCHAR(1000) NOT NULL,
    [survey] NVARCHAR(1000) NOT NULL,
    [score] INT,
    [reason] NVARCHAR(1000),
    [text] NVARCHAR(max),
    [messageId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SurveyResponse_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SurveyResponse_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AdminUser] (
    [id] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [passwordHash] NVARCHAR(1000) NOT NULL,
    [roles] NVARCHAR(1000) NOT NULL,
    [active] BIT NOT NULL CONSTRAINT [AdminUser_active_df] DEFAULT 1,
    [lastLoginAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AdminUser_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AdminUser_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AdminUser_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[AuditLog] (
    [id] NVARCHAR(1000) NOT NULL,
    [actor] NVARCHAR(1000) NOT NULL,
    [action] NVARCHAR(1000) NOT NULL,
    [entity] NVARCHAR(1000) NOT NULL,
    [entityId] NVARCHAR(1000),
    [detail] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AuditLog_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Client_lifecycleStage_idx] ON [dbo].[Client]([lifecycleStage]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Client_valueTier_idx] ON [dbo].[Client]([valueTier]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Client_phone_idx] ON [dbo].[Client]([phone]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Client_email_idx] ON [dbo].[Client]([email]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Device_clientId_idx] ON [dbo].[Device]([clientId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ConsentAudit_clientId_createdAt_idx] ON [dbo].[ConsentAudit]([clientId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Suppression_clientId_idx] ON [dbo].[Suppression]([clientId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PriceAlert_metal_active_idx] ON [dbo].[PriceAlert]([metal], [active]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Template_key_channel_language_status_idx] ON [dbo].[Template]([key], [channel], [language], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Message_clientId_channel_sentAt_idx] ON [dbo].[Message]([clientId], [channel], [sentAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Message_status_releaseAt_idx] ON [dbo].[Message]([status], [releaseAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Message_providerMessageId_idx] ON [dbo].[Message]([providerMessageId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Message_campaignId_idx] ON [dbo].[Message]([campaignId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Message_journeyEnrollmentId_idx] ON [dbo].[Message]([journeyEnrollmentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Message_guardKey_idx] ON [dbo].[Message]([guardKey]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Message_createdAt_idx] ON [dbo].[Message]([createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DeliveryEvent_messageId_idx] ON [dbo].[DeliveryEvent]([messageId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InboxItem_clientId_createdAt_idx] ON [dbo].[InboxItem]([clientId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Banner_active_startsAt_endsAt_idx] ON [dbo].[Banner]([active], [startsAt], [endsAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EventLog_type_occurredAt_idx] ON [dbo].[EventLog]([type], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EventLog_clientExternalId_idx] ON [dbo].[EventLog]([clientExternalId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PriceTick_metal_occurredAt_idx] ON [dbo].[PriceTick]([metal], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [JourneyEnrollment_journeyKey_status_idx] ON [dbo].[JourneyEnrollment]([journeyKey], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [JourneyEnrollment_clientId_status_idx] ON [dbo].[JourneyEnrollment]([clientId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [JourneyStepRun_status_fireAt_idx] ON [dbo].[JourneyStepRun]([status], [fireAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [JourneyStepRun_enrollmentId_idx] ON [dbo].[JourneyStepRun]([enrollmentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [HoldoutAssignment_scope_holdout_idx] ON [dbo].[HoldoutAssignment]([scope], [holdout]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CallTask_status_dueAt_idx] ON [dbo].[CallTask]([status], [dueAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SurveyResponse_survey_createdAt_idx] ON [dbo].[SurveyResponse]([survey], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_entity_entityId_idx] ON [dbo].[AuditLog]([entity], [entityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_createdAt_idx] ON [dbo].[AuditLog]([createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[Device] ADD CONSTRAINT [Device_clientId_fkey] FOREIGN KEY ([clientId]) REFERENCES [dbo].[Client]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Consent] ADD CONSTRAINT [Consent_clientId_fkey] FOREIGN KEY ([clientId]) REFERENCES [dbo].[Client]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ConsentAudit] ADD CONSTRAINT [ConsentAudit_clientId_fkey] FOREIGN KEY ([clientId]) REFERENCES [dbo].[Client]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PriceAlert] ADD CONSTRAINT [PriceAlert_clientId_fkey] FOREIGN KEY ([clientId]) REFERENCES [dbo].[Client]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Message] ADD CONSTRAINT [Message_clientId_fkey] FOREIGN KEY ([clientId]) REFERENCES [dbo].[Client]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DeliveryEvent] ADD CONSTRAINT [DeliveryEvent_messageId_fkey] FOREIGN KEY ([messageId]) REFERENCES [dbo].[Message]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InboxItem] ADD CONSTRAINT [InboxItem_clientId_fkey] FOREIGN KEY ([clientId]) REFERENCES [dbo].[Client]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[JourneyEnrollment] ADD CONSTRAINT [JourneyEnrollment_clientId_fkey] FOREIGN KEY ([clientId]) REFERENCES [dbo].[Client]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[JourneyStepRun] ADD CONSTRAINT [JourneyStepRun_enrollmentId_fkey] FOREIGN KEY ([enrollmentId]) REFERENCES [dbo].[JourneyEnrollment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[OfferApproval] ADD CONSTRAINT [OfferApproval_offerId_fkey] FOREIGN KEY ([offerId]) REFERENCES [dbo].[Offer]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[HoldoutAssignment] ADD CONSTRAINT [HoldoutAssignment_clientId_fkey] FOREIGN KEY ([clientId]) REFERENCES [dbo].[Client]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CallTask] ADD CONSTRAINT [CallTask_clientId_fkey] FOREIGN KEY ([clientId]) REFERENCES [dbo].[Client]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SurveyResponse] ADD CONSTRAINT [SurveyResponse_clientId_fkey] FOREIGN KEY ([clientId]) REFERENCES [dbo].[Client]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

