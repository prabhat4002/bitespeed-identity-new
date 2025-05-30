const request = require('supertest');
const express = require('express');
const identifyRoutes = require('../src/routes/identify');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
app.use(express.json());
app.use('/identify', identifyRoutes);

describe('POST /identify', () => {
  beforeEach(async () => {
    // Clear the database before each test
    await prisma.contact.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('should create a new primary contact', async () => {
    const response = await request(app)
      .post('/identify')
      .send({ email: 'lorraine@hillvalley.edu', phoneNumber: '123456' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact).toEqual({
      primaryContatctId: expect.any(Number),
      emails: ['lorraine@hillvalley.edu'],
      phoneNumbers: ['123456'],
      secondaryContactIds: []
    });
  });

  test('should link existing contact with new email', async () => {
    // Create a primary contact
    await prisma.contact.create({
      data: {
        email: 'lorraine@hillvalley.edu',
        phoneNumber: '123456',
        linkPrecedence: 'primary'
      }
    });

    const response = await request(app)
      .post('/identify')
      .send({ email: 'mcfly@hillvalley.edu', phoneNumber: '123456' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact).toEqual({
      primaryContatctId: 1,
      emails: ['lorraine@hillvalley.edu', 'mcfly@hillvalley.edu'],
      phoneNumbers: ['123456'],
      secondaryContactIds: [expect.any(Number)]
    });
  });

  test('should return 400 for invalid email', async () => {
    const response = await request(app)
      .post('/identify')
      .send({ email: 'invalid-email', phoneNumber: '123456' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid email format' });
  });
});