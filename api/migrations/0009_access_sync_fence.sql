-- Reserved for coordinated privileged mutations by the separate future ADM.
-- Customer endpoints can never set/clear this fence. In-flight projections use
-- Firestore version preconditions; a pending mutation must fail closed in D1.
ALTER TABLE access_accounts ADD COLUMN sync_pending INTEGER NOT NULL DEFAULT 0 CHECK(sync_pending IN (0,1));
