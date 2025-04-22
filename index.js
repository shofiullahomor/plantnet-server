require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const nodemailer = require("nodemailer");
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 9000;
const app = express();
// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};
// send email via nodemailer
const sendEmail = (emailAddress, emailData) => {
  // const emailData = {
  //   subject: "This is a very important subject",
  //   message: "Nice Message",
  // };
  // crerate a transporter
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // true for port 465, false for other ports
    auth: {
      user: process.env.NODEMAILER_USER,
      pass: process.env.NODEMAILER_PASS,
    },
  });
  transporter.verify((error, success) => {
    if (error) {
      console.log(error);
    } else {
      console.log(success);
    }
  });
  // transporter.sendMail();
  const mailBody = {
    from: process.env.NODEMAILER_USER, // sender address
    to: emailAddress,
    subject: emailData?.subject, // Subject line

    html: `<p>${emailData?.message}</p>`, // html body
  };
  transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      console.log(info);
      console.log("Email Sent:" + info?.response);
    }
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zpfgk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const db = client.db("plantNet-session");
    const usersCollection = db.collection("users");
    const plantsCollection = db.collection("plants");
    const ordersCollection = db.collection("orders");
    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      // console.log("data from verifyToken middleware-->", req.user);
      const email = req.user?.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "admin")
        return res.status(403).send({ message: "forbidden access" });
      next();
    };
    // verify seller middleware
    const verifySeller = async (req, res, next) => {
      // console.log("data from verifyToken middleware-->", req.user);
      const email = req.user?.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "seller")
        return res.status(403).send({ message: "forbidden access" });
      next();
    };

    // users data saveing in db
    app.post("/users/:email", async (req, res) => {
      sendEmail();
      const email = req.params.email;
      const query = { email };
      const user = req.body;
      //  check if user already exist in db
      const isExist = await usersCollection.findOne(query);
      if (isExist) {
        return res.send(isExist);
      }
      const result = await usersCollection.insertOne({
        ...user,
        role: "customer",
        timestamp: Date.now(),
      });
      res.send(result);
    });
    // manage user status
    app.patch("/users/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      // const status = req.body.status;
      const filter = { email };
      const user = await usersCollection.findOne(filter);
      if (!user || user?.status === "Requested")
        return res
          .status(400)
          .send("You have already requested to become a seller");
      const updateDoc = {
        $set: {
          status: "Requested",
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
    // get all users
    app.get("/all-users/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const query = { email: { $ne: email } };
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });
    // update a user role & status
    app.patch(
      "/user/role/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const { role } = req.body;
        const filter = { email };
        const updateDoc = {
          $set: { role, status: "Approved" },
        };
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );
    // get user role
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send({ role: result?.role });
    });
    // get inventory data for seller
    app.get("/plants/seller", verifyToken, verifySeller, async (req, res) => {
      const email = req.user.email;

      const result = await plantsCollection
        .find({ "seller.email": email })
        .toArray();
      res.send(result);
    });
    // delete a plant from db by seller
    app.delete("/plants/:id", verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await plantsCollection.deleteOne(query);
      res.send(result);
    });
    // Generate jwt token
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
      } catch (err) {
        res.status(500).send(err);
      }
    });
    // save a plant in db
    app.post("/plants", verifyToken, verifySeller, async (req, res) => {
      const plant = req.body;
      const result = await plantsCollection.insertOne(plant);
      res.send(result);
    });
    // get all plants from db
    app.get("/plants", async (req, res) => {
      const result = await plantsCollection.find().toArray();
      res.send(result);
    });
    // get a plant by id
    app.get("/plants/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await plantsCollection.findOne(query);
      res.send(result);
    });
    // save order data in db
    app.post("/order", verifyToken, async (req, res) => {
      const orderInfo = req.body;
      console.log(orderInfo);
      const result = await ordersCollection.insertOne(orderInfo);
      // send Email
      if (result?.insertedId) {
        //to customer
        sendEmail(orderInfo?.customer?.email, {
          subject: "Order successfully placed",
          message: `You've placed an order successfully. Transaction Id: ${result?.insertedId}`,
        });
        //to seller
        sendEmail(orderInfo?.seller, {
          subject: "Hurrah! you have an order to process",
          message: `Get the plants ready for  ${orderInfo?.customer?.name}`,
        });
      }
      res.send(result);
    });
    // Manage plant quantitiy
    app.patch("/plants/quantity/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { quantityToUpdate, status } = req.body;
      const filter = { _id: new ObjectId(id) };
      let updateDoc = {
        $inc: { quantity: -quantityToUpdate },
      };
      if (status === "increase") {
        updateDoc = {
          $inc: { quantity: quantityToUpdate },
        };
      }
      const result = await plantsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
    // get all orders for a specific customer
    app.get("/customer-orders/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "customer.email": email };
      const result = await ordersCollection
        .aggregate([
          {
            $match: query, // Match specific customers data only by email
          },
          {
            $addFields: {
              plantId: { $toObjectId: "$plantId" }, // convert plant string field to object field
            },
          },
          {
            // go to a different collection and look for data
            $lookup: {
              from: "plants", // collection name
              localField: "plantId", // local data that you want to match
              foreignField: "_id", // foreign field name of that same data
              as: "plants", // return the data as plants array (array naming)
            },
          },
          {
            $unwind: "$plants", // unwind lookup result , return without array
          },
          {
            $addFields: {
              //
              name: "$plants.name",
              image: "$plants.image",
              category: "$plants.category",
            },
          },
          {
            $project: {
              plants: 0,
            },
          },
        ])
        .toArray();
      res.send(result);
    });
    // get all orders for a specific seller
    app.get(
      "/seller-orders/:email",
      verifyToken,
      verifySeller,
      async (req, res) => {
        const email = req.params.email;
        const query = { seller: email };
        const result = await ordersCollection
          .aggregate([
            {
              $match: query, // Match specific customers data only by email
            },
            {
              $addFields: {
                plantId: { $toObjectId: "$plantId" }, // convert plant string field to object field
              },
            },
            {
              // go to a different collection and look for data
              $lookup: {
                from: "plants", // collection name
                localField: "plantId", // local data that you want to match
                foreignField: "_id", // foreign field name of that same data
                as: "plants", // return the data as plants array (array naming)
              },
            },
            {
              $unwind: "$plants", // unwind lookup result , return without array
            },
            {
              $addFields: {
                //
                name: "$plants.name",
              },
            },
            {
              $project: {
                plants: 0,
              },
            },
          ])
          .toArray();
        res.send(result);
      }
    );
    // update a order status
    app.patch("/orders/:id", verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { status },
      };
      const result = await ordersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
    // cancel/delete an order
    app.delete("/orders/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const order = await ordersCollection.findOne(query);
      if (order.status === "Delivered")
        return res
          .status(409)
          .send("Can not cancel once the product is delivered");
      const result = await ordersCollection.deleteOne(query);
      res.send(result);
    });

    // Admin start
    app.get("/admin-stat", verifyToken, verifyAdmin, async (req, res) => {
      // get total user, total plants,
      const totalUsers = await usersCollection.estimatedDocumentCount();
      const totalPlants = await plantsCollection.estimatedDocumentCount();

      const allOrders = await ordersCollection.find().toArray();
      // const totalOrders = allOrders.length;
      // const totalPrice = allOrders.reduce((sum, order) => sum + order.price, 0);
      // charts details
      const chartData = await ordersCollection
        .aggregate([
          { $sort: { _id: -1 } },
          {
            $addFields: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: { $toDate: "$_id" },
                },
              },
              quantity: {
                $sum: "$quantity",
              },
              price: {
                $sum: "$price",
              },
              orders: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              date: "$_id",
              quantity: 1,
              orders: 1,
              price: 1,
            },
          },
        ])
        .toArray();

      // get total revenue, total orders
      const ordersDetails = await ordersCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: "$price" },
              totalOrders: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
            },
          },
        ])
        .next();

      res.send({ totalUsers, totalPlants, ...ordersDetails, chartData });
    });
    // create payment intent
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { quantity, plantId } = req.body;
      const plant = await plantsCollection.findOne({
        _id: new ObjectId(plantId),
      });
      if (!plant) return res.status(404).send({ message: "plant not found" });
      const totalPrice = plant.price * quantity * 100;
      const { client_secret } = await stripe.paymentIntents.create({
        amount: totalPrice,
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
      });
      res.send({ clientSecret: client_secret });
    });
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from plantNet Server..");
});

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`);
});
