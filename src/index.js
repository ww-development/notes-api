require('dotenv').config()

const app = require('express')()

app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', process.env.ALLOWED_URL);
  res.header('Access-Control-Allow-Credentials', true);
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE')
  next();
});

const faunadb = require('faunadb')
const client = new faunadb.Client({ secret: process.env.SECRET_KEY })

const { OAuth2Client } = require('google-auth-library')
const oauth_client = new OAuth2Client(process.env.CLIENT_ID)

const bodyParser = require('body-parser')
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

const q = faunadb.query

const port = process.env.PORT || 8080

const formatData = require('./formatData')

var session = require("express-session")
const cookieParser = require('cookie-parser')
app.set('trust proxy', 1)
app.enable("trust proxy")
app.use(session({
  secret: 'keyboard cat',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: true }
}))

app.use(cookieParser())

app.post('/auth/google', async (req, res) => {
  const currentDate = new Date()

  const { token } = req.body
  const ticket = await oauth_client.verifyIdToken({
    idToken: token,
    audience: process.env.CLIENT_ID
  })

  const { name, email } = ticket.getPayload()
  
  const data = {
    email: email,
    username: name.split(" ").join("") + (Math.floor(Math.random() * 99)).toString(),
    name: name,
    dateJoined: q.Date(currentDate.toISOString().substring(0, 10))
  }

  const user = await client.query(
    q.Let(
      {
        ref: q.Match(q.Index("users_by_email"), data.email),
      },
      q.If(
        q.Exists(q.Var("ref")),
        q.Get(q.Var("ref")),
        q.Create(
          q.Collection("users"),
          { data: data }
        )
      )
    )
  )

  res.cookie("userID", user.ref.id)
  res.status(201)
  res.json({ user: user })
})

app.get('/note/user', async (req, res) => {
  console.log(req.cookies)

  const doc = await client.query(
    q.Map(
      q.Paginate(
        q.Match(
          q.Index('notes_by_user'),
          q.Ref(q.Collection('users'), req.cookies.userID)
        )
      ),
      q.Lambda('note', q.Get(q.Var('note')))
    )
  )
    .catch(e => console.log(e))

  console.log(doc)
  
  const notes = formatData.formatNoteArray(doc.data)

  const doc2 = await client.query(
    q.Map(
      q.Paginate(
        q.Match(
          q.Index("folders_by_user"),
          q.Ref(q.Collection("users"), req.cookies.userID)
        )
      ),
      q.Lambda("folder", q.Get(q.Var("folder")))
    )
  )

  console.log(doc2)

  const folders = formatData.formatFolderArray(doc2.data)

  const notesFolders = notes.concat(folders)

  res.json(notesFolders)
})

app.get('/note/get/:noteID', async (req, res) => {
  const doc = await client.query(
    q.Get(
      q.Ref(
        q.Collection('notes'),
        req.params.noteID
      )
    )
  )
    .catch(e => {
      console.log(e)
      res.json(`Request failed with error: ${e}`)
    })

  const note = formatData.formatNote(doc)

  res.json(note)
})

app.delete('/note/delete/:noteID', async (req, res) => {
  await client.query(
    q.Delete(
      q.Ref(
        q.Collection('notes'),
        req.params.noteID
      )
    )
  )
    .catch(e => {
      console.log(e)
      res.send(`Failed to delete note with id ${req.params.noteID}.`)
    })

  res.send(`Deleted note with id ${doc.ref.id}.`)
})

app.post('/note/add', async (req, res) => {
  const currentDate = new Date()

  const data = {
    userRef: q.Ref(q.Collection('users'), req.cookies.userID),
    folderRef: q.Ref(q.Collection('folders'), req.body.parentId),
    title: req.body.title,
    content: req.body.content,
    type: "file",
    date: q.Date(currentDate.toISOString().substring(0, 10))
  }

  const doc = await client.query(
    q.Create(
      q.Collection('notes'),
      { data }
    )
  )
    .catch(e => {
      console.log(e)
      res.send('Failed to create note.')
    })

  res.send(`Created note with id ${doc.ref.id}`)
})

app.put('/note/update/:noteID', async (req, res) => {
  const currentDate = new Date()

  console.log(req.body)

  const data = {
    userID: req.body.userID,
    parentId: req.body.parentId,
    type: "file",
    title: req.body.title,
    content: req.body.content,
    date: q.Date(currentDate.toISOString().substring(0, 10))
  }

  const doc = await client.query(
    q.Update(
      q.Ref(
        q.Collection('notes'),
        req.params.noteID
      ),
      {
        data: {
          userRef: q.Ref(q.Collection("users"), data.userID),
          folderRef: q.Ref(q.Collection("folders"), data.parentId),
          title: data.title,
          content: data.content,
          date: data.date,
          type: data.type
        }
      }
    )
  )
    .catch(e => console.log(e))

  // res.send(`Note with id ${doc.ref.id} updated.`)
  res.send(doc)
})

app.post("/folder/add", async (req, res) => {
  const doc = await q.Create(
    q.Collection("folders"),
    {
      data: {
        userRef: q.Ref(q.Collection("users"), req.cookies.userID),
        name: req.body.name,
        parentId: req.body.parentId
      }
    }
  )
  .catch(e => console.log(e))

  res.send(`Folder created with ID of ${doc.ref.id}`)
})

app.put("/folder/update/:folderID", async (req, res) => {
  const doc = await client.query(
    q.Update(
      q.Ref(q.Collection("folders"), req.params.folderID),
      {
        data: {
          userRef: q.Ref(q.Collection("users"), req.cookies.userID),
          name: req.body.name,
          parentId: req.body.parentId
        }
      }
    )
  )
})

app.delete("folder/delete/:folderID", async (req, res) => {
  const doc = await client.query(
    q.Delete(
      q.Ref(q.Collection("folders"), req.params.folderID)
    )
  )
  .catch(e => console.log(e))

  res.send(`Folder deleted with ID of ${doc.ref.id}`)
})

app.delete('/auth/logout', async (req, res) => {
  res.status(200)
  res.json({
    message: 'Logged out successfully.'
  })
})

app.listen(port, () => console.log(`Listening on port ${port}.`))