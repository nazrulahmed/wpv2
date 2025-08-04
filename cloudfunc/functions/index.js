const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();

const WHATSAPP_API_URL = "https://whatsapp-api.nazrulahmed.com";

exports.sendScheduledCampaigns = functions.pubsub
  .schedule("every 2 minutes")
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    functions.logger.log("🔄 Running scheduled campaign job at:", now.toDate());

    // Query 'Scheduled' campaigns due now
    const scheduledQuery = db
      .collection("campaigns")
      .where("status", "==", "Scheduled")
      .where("scheduledAt", "<=", now);

    // Query 'Queued' campaigns with null scheduledAt
    const queuedQuery = db
      .collection("campaigns")
      .where("status", "==", "Queued")
      .where("scheduledAt", "==", null);

    const [scheduledSnapshot, queuedSnapshot] = await Promise.all([
      scheduledQuery.get(),
      queuedQuery.get(),
    ]);

    const allDocs = [...scheduledSnapshot.docs, ...queuedSnapshot.docs];

    if (allDocs.length === 0) {
      functions.logger.log("✅ No scheduled or queued campaigns are due.");
      return null;
    }

    const promises = allDocs.map(async (doc) => {
      const campaignId = doc.id;
      const campaign = doc.data();

      if (campaign.status === "Scheduled") {
        await doc.ref.update({ status: "Queued", scheduledAt: null });
      }

      functions.logger.log(`🚀 Processing campaign: ${campaignId}`);

      try {
        const { userId, message, recipients } = campaign;
        let successfulSends = 0;
        let failed = false;

        for (const recipient of recipients) {
          const phone =
            typeof recipient === "string"
              ? recipient
              : recipient.Phone || recipient.phone || null;

          if (!phone) {
            functions.logger.warn(`❌ Invalid recipient format in campaign ${campaignId}`, recipient);
            failed = true;
            continue;
          }

          try {
            const text = encodeURIComponent(message);
            const url = `${WHATSAPP_API_URL}/sendMessage/${userId}/${phone}/${text}`;
            const response = await axios.get(url);

            if (response.status === 200) {
              successfulSends++;
              functions.logger.log(`✅ Sent message to ${phone}`);
            } else {
              failed = true;
              functions.logger.warn(
                `⚠️ Failed to send to ${phone} for campaign ${campaignId}. Status: ${response.status}`
              );
            }
          } catch (err) {
            failed = true;
            functions.logger.error(
              `❌ Error sending to recipient ${phone} for campaign ${campaignId}:`,
              err.message || err
            );
          }
        }

        if (failed || successfulSends === 0) {
          await doc.ref.update({ status: "Failed" });
          functions.logger.warn(`❌ Campaign ${campaignId} failed. No tokens deducted.`);
          return;
        }

        // Deduct tokens
        const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
        const tokensToDeduct = successfulSends * wordCount;

        const userRef = db.collection("users").doc(userId);
        await userRef.update({
          tokens: admin.firestore.FieldValue.increment(-tokensToDeduct),
        });

        await doc.ref.update({ status: "Sent" });
        functions.logger.log(`✅ Campaign ${campaignId} sent. Tokens deducted: ${tokensToDeduct}`);
      } catch (error) {
        functions.logger.error(`❌ Error processing campaign ${campaignId}:`, error.message || error);
        await doc.ref.update({ status: "Failed" });
      }
    });

    await Promise.all(promises);
    return null;
  });
