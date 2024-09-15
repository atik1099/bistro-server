const express = require("express");
const app = express();
const cors = require("cors");
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

//dotenv
require("dotenv").config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

//middleware
app.use(
  cors({
    origin: ["http://localhost:5173","https://dimple-project-8c98f.web.app","https://dimple-project-8c98f.firebaseapp.com"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

//custom middleware
const verifyToken = async (req, res, next) => {
  //token get from cookies
  const token = req?.cookies?.token;
  //console.log('token inside middleware: ',token);

  if (!token) {
    return res.status(401).send({ message: "Unauthorised Access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorised Access" });
    }

    req.decodedUser = decoded;
    next();
  });
};

app.get("/", (req, res) => {
  res.send("Welcome to the bistro boss");
});

const uri = `mongodb+srv://${process.env.bistroUser}:${process.env.bistroPass}@cluster0.ljq2tzl.mongodb.net/?retryWrites=true&w=majority`;

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
    // Connect the client to the server	(optional starting in v4.7)
    //await client.connect();

    // Get the database and collection on which to run the operation
    const database = client.db("bistroDb");
    const menus = database.collection("menus");
    const reviews = database.collection("reviews");
    const carts = database.collection("carts");
    const users = database.collection("users");
    const payments = database.collection("payments");

    //verify Admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decodedUser?.email;
      //console.log(email);
      let query = { email: email };

      const user = await users.findOne(query);

      const isAdmin = user?.role === "Admin";

      if (!isAdmin) {
        return res.status(403).send({ status: "forbidden Access" });
      }

      next();
    };

    //jwt post api endpoint
    app.post("/api/v1/jwt", (req, res) => {
      const user = req.body;
      //console.log(user);
      const token = jwt.sign(user, process.env.ACCESS_TOKEN, {
        expiresIn: "1h",
      });
      //token set into cookies

      res
        .cookie("token", token, {
          httpOnly: true,
          secure: true,
          sameSite:"none"
        })
        .send({ status: true });
    });

    //admin api endpoint
    app.get("/api/v1/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      //console.log(email,req.decodedUser?.email);
      if (req.decodedUser?.email !== email) {
        return res.status(403).send({ status: "forbidden Access" });
      }

      let query = { email: email };

      //find user by query
      const user = await users.findOne(query);

      // //make a admin false initially
      let isAdmin = false;

      if (user) {
        isAdmin = user?.role === "Admin";
      }

      res.send({ isAdmin: isAdmin });
    });

    //count menus for pagination
    app.get("/api/v1/menusCount", async (req, res) => {
      const result = await menus.estimatedDocumentCount();
      res.send({ count: result });
    });

    //menus api end point
    app.get("/api/v1/menus", async (req, res) => {
      const result = await menus.find().toArray();
      res.send(result);
    });

    //PAYMENT-INTENT API   ENDPOINT
    app.post("/api/v1/create-payment-intent", verifyToken, async (req, res) => {
      //get price from body
      const { price } = req.body;

      //price into poisha
      const amount = parseInt(price * 100);
      //console.log(amount, 146);

      if (amount > 0) {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      }
    });

    //reviews api endpoint
    app.get("/api/v1/reviews", async (req, res) => {
      const result = await reviews.find().sort({rating:-1}).toArray();
      res.send(result);
    });

    //reviews find by email and estimate count
    app.get("/api/v1/reviews/:email", async (req, res) => {
      const email = req.params.email
      const result = await reviews.find({email:email}).toArray();
      res.send(result);
    });

    //users api endpoint
    app.get("/api/v1/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await users.find().toArray();
      res.send(result);
    });

    //carts api endpoint
    app.get("/api/v1/carts", verifyToken, async (req, res) => {
      let { email } = req.query;
      let result;
      if (!email) {
        return res.status(400).send({ error: "Email is required" });
      }
      if (req.decodedUser?.email === email) {
        // console.log("match");
        result = await carts.find({ email: email }).toArray();
      } else {
        res.status(403).send({ status: "unauthorized" });
      }
      res.send(result);
    });

    //payments api endpoint
    app.get("/api/v1/payments/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (req.decodedUser?.email !== email) {
        return res.status(403).json({ message: "forbidden access" });
      }

      const query = {
        email: email,
      };
      // console.log(email);
      const result = await payments.find(query).sort({ date: -1 }).toArray();
      res.send(result);
    });

    //admin orders api endpoint
    app.get(
      "/api/v1/orders/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        if (email !== req?.decodedUser?.email) {
          return res.status(403).json({ message: "forbidden access" });
        }
        const result = await payments.find().sort({ date: -1 }).toArray();
        res.send(result);
      }
    );

    //admin charts category sales api endpoint
    app.get("/api/v1/category-sales",verifyToken,verifyAdmin, async (req, res) => {
      const categorySales = await payments.aggregate([
        {
          $unwind:"$menuIds"
        },
        {
          $lookup:{
            from : 'menus',
            localField:'menuIds',
            foreignField:'_id',
            as:'menu'
          }
        },
        {
          $unwind:'$menu'
        },
        {
          $group:{
            _id:'$menu.category',
            totalSales:{$sum : 1},
            totalRevenue:{$sum:'$menu.price'}
          }
        },
        {
          $project:{
            category:'$_id',
            totalSales:1,
            _id:0,
            totalRevenue:1
          }
        }
      ]).toArray()

      res.send(categorySales)
    });

    //single cart api endpoint
    app.get("/api/v1/carts/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await carts.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    //single user api endpoint
    app.get("/api/v1/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await users.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    //single menu api endpoint

    app.get("/api/v1/menus/:id", async (req, res) => {
      const id = req.params.id;
      //console.log(id);
      const filter = { _id:(id) };
      const result = await menus.findOne(filter);
      //console.log(result);
      res.send(result);
    });

    

    //admin-stats api endpoint
    app.get("/api/v1/admin-stats", async (req, res) => {
      const customers = await users.estimatedDocumentCount();
      const products = await menus.estimatedDocumentCount();
      const orders = await payments.estimatedDocumentCount();
      const revenue = await payments
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: "$amount" },
            },
          },
        ])
        .toArray();

      const total = revenue.length > 0 ? revenue[0].totalRevenue : 0;
      res.send({ customers, products, orders, total });
    });

    //cart post api endpoint
    app.post("/api/v1/carts", async (req, res) => {
      const cart = req.body;
      const result = await carts.insertOne(cart);
      res.send(result);
    });

    //payment post api endpoint
    app.post("/api/v1/payments", verifyToken, async (req, res) => {
      const paymentInfo = req.body;
      const query = {
        _id: {
          $in: paymentInfo.cartIds.map((id) => new ObjectId(id)),
        },
      };

      //delete cart Information
      const deleteCartInfo = await carts.deleteMany(query);
      const result = await payments.insertOne(paymentInfo);

      res.send({ result, deleteCartInfo });
    });

    //menus post api endpoint
    app.post("/api/v1/menus", verifyToken, verifyAdmin, async (req, res) => {
      const menu = req.body;
      // console.log(menu);
      const result = await menus.insertOne(menu);
      res.send(result);
    });

    //reviews post api endpoint
    app.post("/api/v1/reviews", async (req, res) => {
      const review = req.body;
      // console.log(review);
      const result = await reviews.insertOne(review);
      res.send(result);
    });

    //user post api endpoint
    app.post("/api/v1/users", async (req, res) => {
      const user = req.body;
      const { email } = user;

      const existingUser = await users.findOne({ email: email });
      if (existingUser) {
        res.send({ message: "This user already exists" });
      } else {
        const result = await users.insertOne(user);
        res.send(result);
      }

      // console.log(email);
    });

    //users update api endpoint
    app.patch("/api/v1/users/:email", async (req, res) => {
      const email = req.params.email;
      const updates = req.body;
      const filter = { email: email };
      const result = await users.updateOne(filter, { $set: updates });
      res.send(result);
    });

    //payements patch api endpoint
    app.patch("/api/v1/payments/:id", async (req, res) => {
      const id = req.params.id;
      const updates = req.body;
      //console.log(id, updates);
      const filter = { _id: new ObjectId(id) };
      const result = await payments.updateOne(filter, { $set: updates });
      res.send(result);
    });

    //menu update api endpoint
    app.patch("/api/v1/menus/:id", async (req, res) => {
      const id = req.params.id;
      //console.log(id);
       const updatesMenu = req.body;
       //console.log(updatesMenu);
      const filter = { _id: new ObjectId(id) };
      const result = await menus.updateOne(filter, { $set: updatesMenu });
      res.send(result);
    });

    //cart delete api endpoint
    app.delete("/api/v1/carts/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await carts.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    //user delete api endpoint
    app.delete(
      "/api/v1/users/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        //console.log(id);
        const result = await users.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      }
    );
    //menu delete api endpoint
    app.delete(
      "/api/v1/menus/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        // console.log(id);
        const result = await menus.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      }
    );

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
run().catch(console.dir);

//port
app.listen(port, () => console.log(`Server started on ${port}`));
