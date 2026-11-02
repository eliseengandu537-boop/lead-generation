ALTER TABLE "Campaign" ADD COLUMN "sendStartHour" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "sendEndHour" INTEGER NOT NULL DEFAULT 24,
 ADD COLUMN "sendWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7];
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_valid_sending_window" CHECK ("sendStartHour">=0 AND "sendEndHour"<=24 AND "sendStartHour"<"sendEndHour");
