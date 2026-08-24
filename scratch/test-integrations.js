require("dotenv").config();
const nodemailer = require("nodemailer");

const payload = {
  couponCode: "TEST-CODE-123",
  consultantPhone: "9345900571",
  entries: [
    { label: "Client Name", value: "Test Client" },
    { label: "Primary Contact", value: "9876543210" }
  ],
  fileAttachment: {
    name: "test_floor_plan.png",
    type: "image/png",
    base64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
  }
};

async function testGoogleSheets() {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  console.log("Webhook URL:", webhookUrl);
  if (!webhookUrl) {
    console.log("No GOOGLE_SHEET_WEBHOOK_URL configured.");
    return;
  }

  try {
    console.log("Sending to Google Sheets...");
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        couponCode: payload.couponCode,
        consultantPhone: payload.consultantPhone,
        entries: payload.entries,
        fileAttachment: payload.fileAttachment
      })
    });

    console.log("Google Sheets response status:", response.status);
    const text = await response.text();
    console.log("Google Sheets response text snippet (first 1000 chars):", text.slice(0, 1000));
    try {
      const json = JSON.parse(text);
      console.log("Parsed JSON:", json);
    } catch (e) {
      console.log("Failed to parse response as JSON. It might be HTML or redirect.");
    }
  } catch (err) {
    console.error("Error in Google Sheets test:", err);
  }
}

async function testResend() {
  const resendApiKey = process.env.RESEND_API_KEY;
  console.log("Resend API Key:", resendApiKey);
  if (!resendApiKey) {
    console.log("No RESEND_API_KEY configured.");
    return;
  }

  try {
    console.log("Sending email via Resend...");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Duro-Max Leads <onboarding@resend.dev>",
        to: "duromaxofficial@gmail.com",
        subject: "📋 Test Duro-Max Lead Submission",
        html: "<p>This is a test from the scratch script.</p>"
      })
    });

    console.log("Resend response status:", response.status);
    const json = await response.json();
    console.log("Resend response JSON:", json);
  } catch (err) {
    console.error("Error in Resend test:", err);
  }
}

async function testNodemailer() {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;
  console.log("Email User:", emailUser);
  console.log("Email Pass is configured:", !!emailPass);

  if (!emailUser || !emailPass) {
    console.log("No email credentials configured.");
    return;
  }

  try {
    console.log("Sending email via Nodemailer...");
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: emailUser,
        pass: emailPass
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
      family: 4,
      tls: {
        rejectUnauthorized: false
      }
    });

    const info = await transporter.sendMail({
      from: `"Duro-Max Leads" <${emailUser}>`,
      to: "duromaxofficial@gmail.com",
      subject: "📋 Test Duro-Max Lead Submission via SMTP",
      text: "This is a test from Nodemailer SMTP."
    });

    console.log("Nodemailer SMTP Success, Message ID:", info.messageId);
  } catch (err) {
    console.error("Error in Nodemailer SMTP test:", err);
  }
}

async function main() {
  await testGoogleSheets();
  console.log("\n-----------------------------------\n");
  await testResend();
  console.log("\n-----------------------------------\n");
  await testNodemailer();
}

main();
