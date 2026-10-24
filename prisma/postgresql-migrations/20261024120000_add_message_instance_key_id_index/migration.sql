CREATE INDEX IF NOT EXISTS "idx_message_instance_key_id" ON "Message" USING btree ("instanceId", (("key" ->> 'id'::text)));
