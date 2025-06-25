const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();

const WHATSAPP_API_URL = "https://whatsapp-api.nazrulahmed.com";

exports.sendScheduledCampaigns = functions.pubsub
  .schedule("every 5 minutes")
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    functions.logger.log("Running scheduled campaign job at:", now.toDate());

    const query = db
      .collection("campaigns")
      .where("status", "==", "Scheduled")
      .where("scheduledAt", "<=", now);

    const snapshot = await query.get();

    if (snapshot.empty) {
      functions.logger.log("No scheduled campaigns are due.");
      return null;
    }

    const promises = snapshot.docs.map(async (doc) => {
      const campaignId = doc.id;
      const campaign = doc.data();

      // Update status to "Queued"
      await doc.ref.update({ status: "Queued" });
      functions.logger.log(`Processing campaign: ${campaignId}`);

      try {
        const { userId, message, recipients } = campaign;
        let successfulSends = 0;

        for (const recipient of recipients) {
          try {
            const text = encodeURIComponent(message);
            const url = `${WHATSAPP_API_URL}/sendMessage/${userId}/${recipient}/${text}`;

            const response = await axios.get(url);

            if (response.status === 200) {
              successfulSends++;
            } else {
              functions.logger.warn(
                `Failed to send to ${recipient} for campaign ${campaignId}. Status: ${response.status}`
              );
            }
          } catch (error) {
            functions.logger.error(
              `Error sending to recipient ${recipient} for campaign ${campaignId}:`,
              error
            );
          }
        }

        // Deduct tokens
        const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
        const tokensToDeduct = successfulSends * wordCount;

        if (tokensToDeduct > 0) {
          const userRef = db.collection("users").doc(userId);
          await userRef.update({
            tokens: admin.firestore.FieldValue.increment(-tokensToDeduct),
          });
          functions.logger.log(`Deducted ${tokensToDeduct} tokens for user ${userId}.`);
        }

        await doc.ref.update({ status: "Sent" });
        functions.logger.log(`Campaign ${campaignId} successfully sent.`);
      } catch (error) {
        functions.logger.error(`Error processing campaign ${campaignId}:`, error);
        await doc.ref.update({ status: "Failed" });
      }
    });

    await Promise.all(promises);
    return null;
  });
