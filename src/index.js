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
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "https://localhost:3000";
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

const allowedDealProperties = [
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "closedate",
  "description",
];

const allowedContactProperties = [
  "firstname",
  "lastname",
  "email",
  "phone",
  "company",
];

const allowedCompanyProperties = [
  "name",
  "domain",
  "phone",
  "city",
  "state",
  "country",
  "industry",
  "numberofemployees",
];

const allowedTaskProperties = [
  "hs_task_subject",
  "hs_task_body",
  "hs_timestamp",
  "hs_task_status",
  "hs_task_priority",
  "hs_task_type",
  "hubspot_owner_id",
];

app.use(helmet());

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
  }),
);

app.use(express.json({ limit: "1mb" }));

/* -------------------- HEALTH -------------------- */

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Outlook HubSpot backend is running",
  });
});

app.get("/api/health/hubspot", async (_req, res) => {
  try {
    await hubspotApi.get("/crm/v3/objects/contacts", {
      params: {
        limit: 1,
        properties: "email",
      },
    });

    res.status(200).json({
      success: true,
      message: "HubSpot connection is healthy",
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
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

app.get("/api/hubspot/contacts/:id", async (req, res) => {
  await getObjectById("contacts", req, res);
});

app.post("/api/hubspot/contacts", async (req, res) => {
  try {
    const { firstname, lastname, email, phone, company, subject, notes } =
      req.body;

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: "A valid email is required",
      });
    }

    const contactProperties = pickProperties(
      req.body,
      allowedContactProperties,
    );

    const contact = await createHubSpotObject("contacts", contactProperties);

    let note = null;

    if (
      typeof subject === "string" &&
      typeof notes === "string" &&
      (subject.trim() || notes.trim())
    ) {
      note = await createContactNote({
        contactId: contact.id,
        subject,
        notes,
      });
    }

    res.status(201).json({
      success: true,
      data: {
        contact,
        note,
      },
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.patch("/api/hubspot/contacts/:id", async (req, res) => {
  try {
    const { subject, notes, noteId, ...contactBody } = req.body;

    const contactProperties = pickProperties(
      contactBody,
      allowedContactProperties,
    );

    let contact = null;
    let note = null;

    if (Object.keys(contactProperties).length > 0) {
      contact = await updateHubSpotObject(
        "contacts",
        req.params.id,
        contactProperties,
      );
    }

    if (typeof subject === "string" || typeof notes === "string") {
      if (noteId) {
        note = await updateContactNote({
          noteId,
          subject,
          notes,
        });
      } else if (subject?.trim() || notes?.trim()) {
        note = await createContactNote({
          contactId: req.params.id,
          subject: subject || "",
          notes: notes || "",
        });
      }
    }

    if (!contact && !note) {
      return res.status(400).json({
        success: false,
        message: "At least one contact property or note field is required",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        contact,
        note,
      },
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.delete("/api/hubspot/contacts/:id", async (req, res) => {
  try {
    const contactId = String(req.params.id || "").trim();

    if (!contactId) {
      return res.status(400).json({
        success: false,
        message: "Contact ID is required",
      });
    }

    await hubspotApi.delete(
      `/crm/v3/objects/contacts/${encodeURIComponent(
        contactId
      )}`
    );

    return res.status(200).json({
      success: true,
      deletedId: contactId,
      message: "Contact deleted successfully",
    });
  } catch (error) {
    console.error(
      "DELETE CONTACT ERROR:",
      error.response?.data || error.message
    );

    return sendHubSpotError(error, res);
  }
});


/* -------------------- CONTACT NOTES -------------------- */

app.get("/api/hubspot/contacts/:id/notes", async (req, res) => {
  try {
    const notes = await getNotesForRecord("contacts", req.params.id);

    res.status(200).json({
      success: true,
      data: {
        results: notes,
      },
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.post("/api/hubspot/contacts/:id/notes", async (req, res) => {
  try {
    const { subject = "", notes = "" } = req.body;

    if (!subject.trim() && !notes.trim()) {
      return res.status(400).json({
        success: false,
        message: "Subject or internal notes are required",
      });
    }

    const note = await createContactNote({
      contactId: req.params.id,
      subject,
      notes,
    });

    res.status(201).json({
      success: true,
      data: note,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.patch(
  "/api/hubspot/contacts/:contactId/notes/:noteId",
  async (req, res) => {
    try {
      const { subject = "", notes = "" } = req.body;

      const note = await updateContactNote({
        noteId: req.params.noteId,
        subject,
        notes,
      });

      res.status(200).json({
        success: true,
        data: note,
      });
    } catch (error) {
      sendHubSpotError(error, res);
    }
  },
);

app.delete(
  "/api/hubspot/contacts/:contactId/notes/:noteId",
  async (req, res) => {
    try {
      await hubspotApi.delete(`/crm/v3/objects/notes/${req.params.noteId}`);

      res.status(200).json({
        success: true,
        message: "Contact note deleted successfully",
      });
    } catch (error) {
      sendHubSpotError(error, res);
    }
  },
);

async function createContactNote({ contactId, subject, notes }) {
  const noteBody = buildNoteBody(subject, notes);

  const note = await createHubSpotObject("notes", {
    hs_timestamp: new Date().toISOString(),
    hs_note_body: noteBody,
  });

  await createDefaultAssociation("notes", note.id, "contacts", contactId);

  return note;
}

async function updateContactNote({ noteId, subject = "", notes = "" }) {
  const response = await hubspotApi.patch(`/crm/v3/objects/notes/${noteId}`, {
    properties: {
      hs_note_body: buildNoteBody(subject, notes),
    },
  });

  return response.data;
}

async function getNotesForRecord(objectType, objectId) {
  const associationResponse = await hubspotApi.get(
    `/crm/v4/objects/${objectType}/${objectId}/associations/notes`,
  );

  const noteIds =
    associationResponse.data.results?.map(
      (item) => item.toObjectId || item.id || item.to?.objectId,
    ) || [];

  const uniqueNoteIds = [...new Set(noteIds.filter(Boolean))];

  const noteResponses = await Promise.all(
    uniqueNoteIds.map((noteId) =>
      hubspotApi.get(`/crm/v3/objects/notes/${noteId}`, {
        params: {
          properties: "hs_note_body,hs_timestamp",
        },
      }),
    ),
  );

  return noteResponses
    .map((response) => response.data)
    .sort((first, second) => {
      const firstDate = first.properties?.hs_timestamp || first.updatedAt || "";

      const secondDate =
        second.properties?.hs_timestamp || second.updatedAt || "";

      return new Date(secondDate).getTime() - new Date(firstDate).getTime();
    });
}

function buildNoteBody(subject = "", notes = "") {
  return [
    subject.trim() ? `Subject Line: ${subject.trim()}` : "",
    notes.trim() ? `Internal Notes: ${notes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

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

app.get("/api/hubspot/companies/:id", async (req, res) => {
  await getObjectById("companies", req, res);
});

app.post("/api/hubspot/companies", async (req, res) => {
  try {
    const properties = pickProperties(req.body, allowedCompanyProperties);

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

app.patch("/api/hubspot/companies/:id", async (req, res) => {
  await updateObjectById("companies", req, res);
});

app.delete("/api/hubspot/companies/:id", async (req, res) => {
  await deleteObjectById("companies", req, res);
});

/* -------------------- DEALS -------------------- */

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

app.get("/api/hubspot/deals/:id", async (req, res) => {
  await getObjectById("deals", req, res);
});

app.post("/api/hubspot/deals", async (req, res) => {
  try {
    const properties = pickProperties(req.body, [
      "dealname",
      "amount",
      "dealstage",
      "pipeline",
      "closedate",
      "description",
    ]);

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
          "Deal stage is required. Get a valid stage from the pipeline endpoint.",
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

app.patch("/api/hubspot/deals/:id", async (req, res) => {
  await updateObjectById("deals", req, res);
});

app.delete("/api/hubspot/deals/:id", async (req, res) => {
  await deleteObjectById("deals", req, res);
});

/* -------------------- DEAL PIPELINES -------------------- */

app.get("/api/hubspot/pipelines/deals", async (_req, res) => {
  try {
    const response = await hubspotApi.get("/crm/v3/pipelines/deals");

    res.status(200).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.get("/api/hubspot/pipelines/deals/:pipelineId/stages", async (req, res) => {
  try {
    const response = await hubspotApi.get(
      `/crm/v3/pipelines/deals/${req.params.pipelineId}/stages`,
    );

    res.status(200).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

/* -------------------- TASKS -------------------- */

app.get("/api/hubspot/tasks", async (req, res) => {
  try {
    const response = await listHubSpotObjects("tasks", req.query);

    res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.get("/api/hubspot/tasks/:id", async (req, res) => {
  await getObjectById("tasks", req, res);
});

app.post("/api/hubspot/tasks", async (req, res) => {
  try {
    const properties = pickProperties(req.body, allowedTaskProperties);

    if (!properties.hs_task_subject) {
      return res.status(400).json({
        success: false,
        message: "Task subject is required",
      });
    }

    if (!properties.hs_timestamp) {
      properties.hs_timestamp = new Date().toISOString();
    }

    if (!properties.hs_task_status) {
      properties.hs_task_status = "NOT_STARTED";
    }

    const task = await createHubSpotObject("tasks", properties);

    const { associatedObjectType, associatedObjectId } = req.body;

    if (associatedObjectType && associatedObjectId) {
      await createDefaultAssociation(
        "tasks",
        task.id,
        associatedObjectType,
        associatedObjectId,
      );
    }

    res.status(201).json({
      success: true,
      data: task,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.patch("/api/hubspot/tasks/:id", async (req, res) => {
  await updateObjectById("tasks", req, res);
});

app.delete("/api/hubspot/tasks/:id", async (req, res) => {
  await deleteObjectById("tasks", req, res);
});

/* -------------------- SEARCH -------------------- */

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
      },
    );

    res.status(200).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

/* -------------------- ASSOCIATIONS -------------------- */

app.get(
  "/api/hubspot/associations/:fromType/:fromId/:toType",
  async (req, res) => {
    try {
      const response = await hubspotApi.get(
        `/crm/v4/objects/${req.params.fromType}/${req.params.fromId}/associations/${req.params.toType}`,
      );

      res.status(200).json({
        success: true,
        data: response.data,
      });
    } catch (error) {
      sendHubSpotError(error, res);
    }
  },
);

app.post("/api/hubspot/associations", async (req, res) => {
  try {
    const { fromType, fromId, toType, toId } = req.body;

    if (!fromType || !fromId || !toType || !toId) {
      return res.status(400).json({
        success: false,
        message: "fromType, fromId, toType and toId are required",
      });
    }

    const response = await createDefaultAssociation(
      fromType,
      fromId,
      toType,
      toId,
    );

    res.status(201).json({
      success: true,
      data: response,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

app.delete("/api/hubspot/associations", async (req, res) => {
  try {
    const { fromType, fromId, toType, toId } = req.body;

    if (!fromType || !fromId || !toType || !toId) {
      return res.status(400).json({
        success: false,
        message: "fromType, fromId, toType and toId are required",
      });
    }

    await hubspotApi.delete(
      `/crm/v4/objects/${fromType}/${fromId}/associations/${toType}/${toId}`,
    );

    res.status(200).json({
      success: true,
      message: "Association deleted successfully",
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
});

async function createDefaultAssociation(fromType, fromId, toType, toId) {
  const response = await hubspotApi.put(
    `/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`,
  );

  return response.data;
}

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

  const defaultProperties = {
    contacts: ["firstname", "lastname", "email", "phone", "company"],
    companies: ["name", "domain", "phone", "city", "state", "country"],
    deals: [
      "dealname",
      "amount",
      "dealstage",
      "pipeline",
      "closedate",
      "description",
    ],
    tasks: [
      "hs_task_subject",
      "hs_task_body",
      "hs_timestamp",
      "hs_task_status",
      "hs_task_priority",
      "hs_task_type",
    ],
  };

  const params = {
    limit,
    archived: query.archived === "true",
    properties: query.properties || defaultProperties[objectType]?.join(","),
  };

  if (query.after) {
    params.after = Number(query.after);
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

async function updateHubSpotObject(objectType, objectId, properties) {
  const response = await hubspotApi.patch(
    `/crm/v3/objects/${objectType}/${objectId}`,
    {
      properties: cleanProperties(properties),
    },
  );

  return response.data;
}

async function getObjectById(objectType, req, res) {
  try {
    const response = await hubspotApi.get(
      `/crm/v3/objects/${objectType}/${req.params.id}`,
      {
        params: req.query.properties
          ? {
              properties: req.query.properties,
            }
          : undefined,
      },
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

    const response = await updateHubSpotObject(
      objectType,
      req.params.id,
      properties,
    );

    res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error) {
    sendHubSpotError(error, res);
  }
}

async function deleteObjectById(objectType, req, res) {
  try {
    await hubspotApi.delete(`/crm/v3/objects/${objectType}/${req.params.id}`);

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
          value !== undefined && value !== null && String(value).trim() !== "",
      )
      .map(([key, value]) => [key, String(value).trim()]),
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
