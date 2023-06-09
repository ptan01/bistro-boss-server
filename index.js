const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const app = express()
const port = process.env.PORT || 5000;

// middleware 
app.use(cors())
app.use(express.json())

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ error: true, message: 'unauthorized access' })
  }
  const token = authorization.split(' ')[1]
  jwt.verify(token, process.env.ASSESS_TOKEN_SECRET, (error, decoded) => {
    if (error) {
      return res.status(401).send({ error: true, message: 'unauthorized access, filed to verify jwt token 😁' })
    }
    req.decoded = decoded;
    next()
  })
}



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8hd0j1r.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const userCollection = client.db('bistroDb').collection('user')
    const menuCollection = client.db('bistroDb').collection('menu')
    const reviewCollection = client.db('bistroDb').collection('reviews')
    const cardCollection = client.db('bistroDb').collection('cards')
    const paymentCollection = client.db('bistroDb').collection('payments')


    // Warning: use verifyJWT before using verifyAdmin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (user?.role !== 'admin') {
        return res.status(403).send({ error: true, message: 'forbidden message' })
      }
      next()
    }



    // json web token jwt api

    app.post('/jwt', (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ASSESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.send({ token })
    })



    // user related api 

    /**
     * 0. do not show secure links to those who should not see the links
     * 1. use jwt token verifyJWT
     * 2. use verify admin middleware function 
     * */

    app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray()
      res.send(result)
    })


    app.get('/users/admin/:email', verifyJWT, async (req, res) => {
      const email = req.params?.email;

      if (req.decoded.email !== email) {
        return res.send({ admin: false })
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      const result = { admin: user?.role === 'admin' };
      res.send(result)
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query)
      if (existingUser) {
        return res.send({ message: 'user is already exist' })
      }
      const result = await userCollection.insertOne(user);
      res.send(result)
    })

    app.patch('/users/admin/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: 'admin'
        },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result)
    })



    // review and menu related api

    app.get('/menu', async (req, res) => {
      const result = await menuCollection.find().toArray()
      res.send(result)
    })

    app.post('/menu', verifyJWT, verifyAdmin, async (req, res) => {
      const menu = req.body;
      const result = await menuCollection.insertOne(menu);
      res.send(result)
    })



    app.delete('/menu/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result)
      console.log(result)
    })

    app.get('/reviews', async (req, res) => {
      const result = await reviewCollection.find().toArray()
      res.send(result)
    })

    // card apis

    app.get('/cards', verifyJWT, async (req, res) => {
      let email = {};
      if (req.query?.email) {
        email = req.query.email;
      }
      const decoded = req.decoded.email;
      if (email !== decoded) {
        return res.status(403).send({ error: true, message: 'forbidden access, filed to verify jwt token email and access email 😁' })
      }

      const query = { email: email };
      const result = await cardCollection.find(query).toArray()
      res.send(result)
    })

    // stripe payment intent api

    app.post('/create-payment-intent', verifyJWT, async (req, res) => {
      const { price } = req.body;
      const calculateOrderAmount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: calculateOrderAmount,
        currency: "usd",
        payment_method_types: ['card']
      })
      res.send({
        clientSecret: paymentIntent.client_secret,
      })
    })

    app.post('/cards', async (req, res) => {
      const card = req.body;
      console.log(card)
      const result = await cardCollection.insertOne(card)
      res.send(result)
    })

    app.delete('/cards/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cardCollection.deleteOne(query);
      res.send(result)
    })

    // payment collection related api 

    app.post('/payments', async (req, res) => {
      const payment = req.body;
      const insartResult = await paymentCollection.insertOne(payment);


      const query = { _id: { $in: payment.cartItems.map(id => new ObjectId(id)) } };
      const deleteResult = await cardCollection.deleteMany(query);
      res.send({ insartResult, deleteResult })
    })

    app.get('/admin-stats', verifyJWT, verifyAdmin, async (req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const products = await menuCollection.estimatedDocumentCount();
      const order = await paymentCollection.estimatedDocumentCount();

      const allOrder = await paymentCollection.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: '$price' }
          }
        }
      ]).toArray();

      const total = allOrder[0].total;

      res.send({
        users,
        products,
        order,
        total
      })
    })


    app.get('/order-stats', async (req, res) => {
      const pipeline = [
        {
          $lookup: {
            from: 'menu',
            localField: 'menuItems',
            foreignField: '_id',
            as: 'menuItems'
          }
        },
        {
          $unwind: '$menuItems'
        },
        {
          $group: {
            _id: '$menuItems.category',
            count: { $sum: 1 },
            totalPrice: { $sum: '$menuItems.price' }
          }
        }
      ]
    const result = await paymentCollection.aggregate(pipeline).toArray() ;

    res.json(result)

    
    })



    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);




app.get('/', (req, res) => {
  res.send('Bistro Boss is Sitting')
})

app.listen(port, () => {
  console.log('The bistro server is running on port', port)
})