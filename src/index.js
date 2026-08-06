const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

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
  throw new Error("HUBSPOT_ACCESS_TOKEN is missing in backend/.env");
}

const hubspotApi = axios.create({
  baseURL: "https://api.hubapi.com",
  timeout: 15000,
  headers: {
    Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
});

const allowedObjects = ["contacts", "companies", "deals"];

app.use(helmet());

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
  })
);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Outlook HubSpot backend is running",
  });
});

/* -------------------- CONTACTS -------------------- */

app.get("/api/hubspot/contacts", async (req, res) => {
  try {
    const response = await listHubSpotObjects("contacts", req.query);

    res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.post("/api/hubspot/contacts", async (req, res) => {
  try {
    const properties = pickProperties(req.body, [
      "firstname",
      "lastname",
      "email",
      "phone",
      "company",
    ]);

    if (!properties.email || typeof properties.email !== "string") {
      return res.status(400).json({
        success: false,
        message: "A valid email is required",
      });
    }

    const response = await createHubSpotObject("contacts", properties);

    res.status(201).json({
      success: true,
      data: response,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

/* -------------------- COMPANIES -------------------- */

app.get("/api/hubspot/companies", async (req, res) => {
  try {
    const response = await listHubSpotObjects("companies", req.query);

    res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.post("/api/hubspot/companies", async (req, res) => {
  try {
    const properties = pickProperties(req.body, [
      "name",
      "domain",
      "phone",
      "city",
      "state",
      "country",
      "industry",
      "numberofemployees",
    ]);

    if (!properties.name || typeof properties.name !== "string") {
      return res.status(400).json({
        success: false,
        message: "Company name is required",
      });
    }

    const response = await createHubSpotObject("companies", properties);

    res.status(201).json({
      success: true,
      data: response,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.get("/api/hubspot/companies/:id", async (req, res) => {
  await getObjectById("companies", req, res);
});

app.patch("/api/hubspot/companies/:id", async (req, res) => {
  await updateObjectById("companies", req, res);
});

app.delete("/api/hubspot/companies/:id", async (req, res) => {
  await deleteObjectById("companies", req, res);
});

/* -------------------- DEALS -------------------- */

const allowedDealProperties = [
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "closedate",
  "description",
];

app.get("/api/hubspot/deals", async (req, res) => {
  try {
    const response = await listHubSpotObjects("deals", req.query);

    res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.post("/api/hubspot/deals", async (req, res) => {
  try {
    const properties = pickProperties(
      req.body,
      allowedDealProperties
    );

    if (!properties.dealname || typeof properties.dealname !== "string") {
      return res.status(400).json({
        success: false,
        message: "Deal name is required",
      });
    }

    if (!properties.pipeline) {
      properties.pipeline = "default";
    }

    if (!properties.dealstage) {
      return res.status(400).json({
        success: false,
        message:
          "Deal stage is required. First get valid stages from /api/hubspot/pipelines/deals/default/stages",
      });
    }

    const response = await createHubSpotObject("deals", properties);

    res.status(201).json({
      success: true,
      data: response,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.get("/api/hubspot/deals/:id", async (req, res) => {
  await getObjectById("deals", req, res);
});

app.patch("/api/hubspot/deals/:id", async (req, res) => {
  try {
    const properties = pickProperties(
      req.body,
      allowedDealProperties
    );

    if (Object.keys(properties).length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "At least one valid deal property is required",
      });
    }

    const response = await hubspotApi.patch(
      `/crm/v3/objects/deals/${req.params.id}`,
      {
        properties: cleanProperties(properties),
      }
    );

    res.status(200).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.delete("/api/hubspot/deals/:id", async (req, res) => {
  await deleteObjectById("deals", req, res);
});

/* -------------------- DEAL PIPELINES -------------------- */

app.get("/api/hubspot/pipelines/deals", async (_req, res) => {
  try {
    const response = await hubspotApi.get(
      "/crm/v3/pipelines/deals"
    );

    res.status(200).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.get(
  "/api/hubspot/pipelines/deals/:pipelineId/stages",
  async (req, res) => {
    try {
      const response = await hubspotApi.get(
        `/crm/v3/pipelines/deals/${req.params.pipelineId}/stages`
      );

      res.status(200).json({
        success: true,
        data: response.data,
      });
    } catch (error) {
      sendHubSpotError(error, res);
    }
  }
);
/* -------------------- CRM SEARCH -------------------- */

app.post("/api/hubspot/:objectType/search", async (req, res) => {
  try {
    const { objectType } = req.params;

    if (!allowedObjects.includes(objectType)) {
      return res.status(400).json({
        success: false,
        message: "Only contacts, companies, and deals are supported",
      });
    }

    const {
      filterGroups = [],
      sorts = [],
      query = "",
      properties = [],
      limit = 10,
      after = 0,
    } = req.body;

    const response = await hubspotApi.post(
      `/crm/v3/objects/${objectType}/search`,
      {
        filterGroups,
        sorts,
        query,
        properties,
        limit: Math.min(Math.max(Number(limit), 1), 100),
        after: Number(after),
      }
    );

    res.status(200).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

/* -------------------- OWNERS -------------------- */

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

/* -------------------- HELPERS -------------------- */

async function listHubSpotObjects(objectType, query) {
  const requestedLimit = Number(query.limit || 10);
  const limit = Math.min(Math.max(requestedLimit, 1), 100);

  const params = {
    limit,
    archived: query.archived === "true",
  };

  if (query.after) {
    params.after = Number(query.after);
  }

  if (query.properties) {
    params.properties = query.properties;
  }

  const response = await hubspotApi.get(`/crm/v3/objects/${objectType}`, {
    params,
  });

  return response.data;
}

async function createHubSpotObject(objectType, properties) {
  const response = await hubspotApi.post(`/crm/v3/objects/${objectType}`, {
    properties: cleanProperties(properties),
  });

  return response.data;
}

async function getObjectById(objectType, req, res) {
  try {
    const response = await hubspotApi.get(
      `/crm/v3/objects/${objectType}/${req.params.id}`
    );

    res.status(200).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
}

async function updateObjectById(objectType, req, res) {
  try {
    const properties = cleanProperties(req.body);

    if (Object.keys(properties).length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one property is required",
      });
    }

    const response = await hubspotApi.patch(
      `/crm/v3/objects/${objectType}/${req.params.id}`,
      {
        properties,
      }
    );

    res.status(200).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
}

async function deleteObjectById(objectType, req, res) {
  try {
    await hubspotApi.delete(
      `/crm/v3/objects/${objectType}/${req.params.id}`
    );

    res.status(200).json({
      success: true,
      message: `${objectType} deleted successfully`,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
}

function pickProperties(body, allowedProperties) {
  const result = {};

  allowedProperties.forEach((property) => {
    if (body[property] !== undefined && body[property] !== null) {
      result[property] = body[property];
    }
  });

  return result;
}

function cleanProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(
        ([, value]) =>
          value !== undefined &&
          value !== null &&
          String(value).trim() !== ""
      )
      .map(([key, value]) => [key, String(value).trim()])
  );
}

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