CREATE TABLE "email_code" (
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text,
	"expires_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp NOT NULL,
	"recent_sends" timestamp[] NOT NULL,
	CONSTRAINT "email_code_email_purpose_pk" PRIMARY KEY("email","purpose"),
	CONSTRAINT "email_code_purpose_check" CHECK ("email_code"."purpose" in ('register', 'join', 'password-reset', 'change-email'))
);
