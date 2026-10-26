const mongoClient = require("mongodb").MongoClient;
const mongoObjectID = require("mongodb").ObjectID;
const bodyParser = require("body-parser");
const express = require("express");
const pino = require("pino");
const expPino = require("express-pino-logger");
const promClient = require("prom-client");

const logger = pino({
  level: "info",
  prettyPrint: false,
  useLevelLabels: true,
});
const expLogger = expPino({
  logger: logger,
});

// MongoDB
var db;
var collection;
var mongoConnected = false;

const register = new promClient.Registry();

const httpRequests = new promClient.Counter({
  name: "robotshop_http_requests",
  help: "Total HTTP requests handled by the catalogue service",
  labelNames: ["service", "method", "route", "status_code"],
  registers: [register],
});

const httpRequestDuration = new promClient.Histogram({
  name: "robotshop_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["service", "method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const app = express();

app.use(expLogger);
app.use((req, res, next) => {
  if (req.path === "/metrics" || req.path === "/health") {
    return next();
  }

  const start = process.hrtime();

  res.once("finish", () => {
    const route = req.route ? req.baseUrl + req.route.path : "unmatched";
    const labels = {
      service: "catalogue",
      method: req.method,
      route: route,
      status_code: String(res.statusCode),
    };

    httpRequests.inc(labels);

    const elapsed = process.hrtime(start);
    httpRequestDuration.observe(labels, elapsed[0] + elapsed[1] / 1e9);
  });

  next();
});

app.use((req, res, next) => {
  res.set("Timing-Allow-Origin", "*");
  res.set("Access-Control-Allow-Origin", "*");
  next();
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get("/health", (req, res) => {
  var stat = {
    app: "OK",
    mongo: mongoConnected,
  };
  res.json(stat);
});

app.get("/metrics", (req, res) => {
  res.header("Content-Type", "text/plain");
  res.send(register.metrics());
});

// all products
app.get("/products", (req, res) => {
  if (mongoConnected) {
    collection
      .find({})
      .toArray()
      .then((products) => {
        res.json(products);
      })
      .catch((e) => {
        req.log.error("ERROR", e);
        res.status(500).send(e);
      });
  } else {
    req.log.error("database not available");
    res.status(500).send("database not avaiable");
  }
});

// product by SKU
app.get("/product/:sku", (req, res) => {
  if (mongoConnected) {
    // optionally slow this down
    const delay = process.env.GO_SLOW || 0;
    setTimeout(() => {
      collection
        .findOne({ sku: req.params.sku })
        .then((product) => {
          req.log.info("product", product);
          if (product) {
            res.json(product);
          } else {
            res.status(404).send("SKU not found");
          }
        })
        .catch((e) => {
          req.log.error("ERROR", e);
          res.status(500).send(e);
        });
    }, delay);
  } else {
    req.log.error("database not available");
    res.status(500).send("database not available");
  }
});

// products in a category
app.get("/products/:cat", (req, res) => {
  if (mongoConnected) {
    collection
      .find({ categories: req.params.cat })
      .sort({ name: 1 })
      .toArray()
      .then((products) => {
        if (products) {
          res.json(products);
        } else {
          res.status(404).send("No products for " + req.params.cat);
        }
      })
      .catch((e) => {
        req.log.error("ERROR", e);
        res.status(500).send(e);
      });
  } else {
    req.log.error("database not available");
    res.status(500).send("database not avaiable");
  }
});

// all categories
app.get("/categories", (req, res) => {
  if (mongoConnected) {
    collection
      .distinct("categories")
      .then((categories) => {
        res.json(categories);
      })
      .catch((e) => {
        req.log.error("ERROR", e);
        res.status(500).send(e);
      });
  } else {
    req.log.error("database not available");
    res.status(500).send("database not available");
  }
});

// search name and description
app.get("/search/:text", (req, res) => {
  if (mongoConnected) {
    collection
      .find({ $text: { $search: req.params.text } })
      .toArray()
      .then((hits) => {
        res.json(hits);
      })
      .catch((e) => {
        req.log.error("ERROR", e);
        res.status(500).send(e);
      });
  } else {
    req.log.error("database not available");
    res.status(500).send("database not available");
  }
});

// set up Mongo
function mongoConnect() {
  return new Promise((resolve, reject) => {
    var mongoURL = process.env.MONGO_URL || "mongodb://mongodb:27017/catalogue";
    mongoClient.connect(mongoURL, (error, client) => {
      if (error) {
        reject(error);
      } else {
        db = client.db("catalogue");
        collection = db.collection("products");
        resolve("connected");
      }
    });
  });
}

// mongodb connection retry loop
function mongoLoop() {
  mongoConnect()
    .then((r) => {
      mongoConnected = true;
      logger.info("MongoDB connected");
    })
    .catch((e) => {
      logger.error("ERROR", e);
      setTimeout(mongoLoop, 2000);
    });
}

mongoLoop();

// fire it up!
const port = process.env.CATALOGUE_SERVER_PORT || "8080";
app.listen(port, () => {
  logger.info("Started on port", port);
});
