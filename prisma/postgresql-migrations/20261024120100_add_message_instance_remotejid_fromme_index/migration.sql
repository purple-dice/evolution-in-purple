CREATE INDEX IF NOT EXISTS "idx_message_instance_remotejid_fromme" ON "Message" USING btree ("instanceId", (("key" ->> 'remoteJid'::text)), ((("key" ->> 'fromMe'::text))::boolean));
