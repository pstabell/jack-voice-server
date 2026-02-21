// Jack Voice Server - API Landing Page
export default function handler(req, res) {
  res.status(200).json({
    name: "Jack Voice Server",
    status: "online",
    version: "1.0.0",
    endpoints: {
      vapi_webhook: "/api/vapi-webhook",
      sms_webhook: "/api/sms-webhook",
      sms_notify: "/api/sms-notify",
      fax_webhook: "/api/fax-webhook"
    },
    documentation: "This is the webhook server for JackBot voice calls via Vapi.ai"
  });
}
