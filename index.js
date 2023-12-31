const express = require('express')
const cors = require('cors');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const app = express()
const port = 5000



app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6codac6.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.status(401).send({ message: 'Unauthorized Access' })
    }
    const token = authHeader.split(' ')[1]
    jwt.verify(token, process.env.SECRET_KEY, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' })
        }
        req.decoded = decoded;
        next()

    });

}
async function run() {
    try {
        await client.connect()
        const serviceCollection = client.db('doctors-portal').collection('services');
        const bookingCollection = client.db('doctors-portal').collection('booking');
        const usersCollection = client.db('doctors-portal').collection('users');
        const doctorCollection = client.db('doctors-portal').collection('doctor');
        const paymentCollection = client.db('doctors-portal').collection('payments');
        // verifyAdmin
        const verifyAdmin = async (req, res, next) => {
            const requested = req.decoded.email;
            const requesterAccount = await usersCollection.findOne({ email: requested });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'Forbidden' })
            }

        }

        app.post('/create-payment-intent', async (req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"]
            });
            res.send({ clientSecret: paymentIntent.client_secret })

        })

        // get all services
        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray();

            // res.send(services)
            res.send({ status: 'Received all services', data: services })
        })

        // this is not proper way
        // use aggregate lookup pipeline ,match 
        // get available
        app.get('/available', async (req, res) => {
            const date = req.query.date
            const services = await serviceCollection.find().toArray()
            const query = { date: date }
            const booking = await bookingCollection.find(query).toArray()
            services.forEach(service => {
                const serviceBookings = booking.filter(b => b.name === service.name);
                const booked = serviceBookings.map(s => s.slot);
                const available = service.slots.filter(s => !booked.includes(s))
                service.slots = available
            })
            res.send({ status: 'Received all services', data: services })
        })
        //get booking
        app.get('/booking', verifyToken, async (req, res) => {
            const patient = req.query.patient;
            const decodedEmail = req.decoded.email;
            if (decodedEmail === patient) {
                const query = { email: patient }
                const booking = await bookingCollection.find(query).toArray();
                return res.send(booking);
            }
            else {
                return res.status(403).send({ message: 'Forbidden Access' })
            }

        })
        // patch
        app.patch('/booking/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const result = await paymentCollection.insertOne(payment);
            const updateBooking = await bookingCollection.updateOne(filter, updatedDoc);
            res.send(updateBooking);

        })
        // get users
        app.get('/users', verifyToken, async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send(users)
        })
        // put user to admin 
        app.put('/user/admin/:email', verifyToken, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send({ status: 'Successfully made an admin', data: result, color: 'success' })
        })
        //get admin
        app.get('/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const user = await usersCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin })

        })

        // put users
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user
            };
            const result = await usersCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.SECRET_KEY, { expiresIn: '1h' })
            res.send({ status: 'success', data: result, token: token })
        })

        // post booking details
        app.post('/booking', async (req, res) => {
            const value = req.body;
            console.log(value);
            const query = { name: value.name, date: value.date, displayName: value.displayName };
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ status: `Already have an appointment on ${value?.date} at ${value?.slot}`, color: 'error', data: exists })
            }
            else {
                const result = await bookingCollection.insertOne(value)
                if (result?.insertedId) {
                    res.send({ status: `Appointment is set on ${value?.date} at ${value?.slot}`, color: 'success', data: result })
                }
                else {
                    res.send({ status: "Failed Booking", color: 'error', data: result })
                }

            }


        })
        // get booking by id
        app.get('/booking/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const result = await bookingCollection.findOne(filter);
            res.send(result);
        })

        // post doctor
        app.post('/doctor', verifyToken, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send({ status: 'Doctor added successfully', data: result });
        })
        // get doctor
        app.get('/doctor', verifyToken, verifyAdmin, async (req, res) => {
            const result = await doctorCollection.find().toArray();
            res.send(result);
        })
        // delete doctor

        app.delete('/doctor/:email', verifyToken, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await doctorCollection.deleteOne(filter);
            res.send({ status: 'Doctor delete successfully', data: result });
        })

    } finally {

    }
}
run().catch(console.dir);
app.get('/', (req, res) => {
    res.send('Hello from doctor uncle ')
})

app.listen(port, () => {
    console.log(`doctor  app listening on port ${port}`)
})