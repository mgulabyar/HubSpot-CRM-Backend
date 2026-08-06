require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const helmet = require("helmet");

const app = express();

const PORT = Number(process.env.PORT || 5000);
const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || "https://localhost:3000";
const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

if (!HUBSPOT_ACCESS_TOKEN) {
  throw new Error("HUBSPOT_ACCESS_TOKEN is missing in .env");
}

const hubspotApi = axios.create({
  baseURL: "https://api.hubapi.com",
  timeout: 15000,
  headers: {
    Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
});

app.use(helmet());

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
  })
);

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Outlook HubSpot backend is running",
  });
});

app.get("/api/hubspot/contacts", async (req, res) => {
  try {
    const requestedLimit = Number(req.query.limit || 10);
    const limit = Math.min(Math.max(requestedLimit, 1), 100);

    const response = await hubspotApi.get("/crm/v3/objects/contacts", {
      params: {
        limit,
        archived: false,
        properties: "firstname,lastname,email,phone,company",
      },
    });

    res.status(200).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.post("/api/hubspot/contacts", async (req, res) => {
  try {
    const { firstname, lastname, email, phone, company } = req.body;

    if (!email || typeof email !== "string") {
      return res.status(400).json({
        success: false,
        message: "A valid email is required",
      });
    }

    const response = await hubspotApi.post("/crm/v3/objects/contacts", {
      properties: {
        email: email.trim(),
        ...(firstname && { firstname: firstname.trim() }),
        ...(lastname && { lastname: lastname.trim() }),
        ...(phone && { phone: phone.trim() }),
        ...(company && { company: company.trim() }),
      },
    });

    res.status(201).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.get("/api/hubspot/owners", async (_req, res) => {
  try {
    const response = await hubspotApi.get("/crm/v3/owners");

    res.status(200).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

function sendHubSpotError(error, res) {
  if (axios.isAxiosError(error)) {
    const statusCode = error.response?.status || 500;

    return res.status(statusCode).json({
      success: false,
      message: "HubSpot API request failed",
      error: error.response?.data || error.message,
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
}

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
// backend working is successfully.