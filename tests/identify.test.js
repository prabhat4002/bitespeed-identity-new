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

  test('should create a new primary contact when no existing contact', async () => {
    const response = await request(app)
      .post('/identify')
      .send({ email: 'lorraine@hillvalley.edu', phoneNumber: '123456' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact).toMatchObject({
      primaryContatctId: expect.any(Number),
      emails: ['lorraine@hillvalley.edu'],
      phoneNumbers: ['123456'],
      secondaryContactIds: []
    });
  });

  test('should create secondary contact when new email with existing phone', async () => {
    // Create initial contact
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
    expect(response.body.contact.emails).toEqual(['lorraine@hillvalley.edu', 'mcfly@hillvalley.edu']);
    expect(response.body.contact.phoneNumbers).toEqual(['123456']);
    expect(response.body.contact.secondaryContactIds).toHaveLength(1);
  });

  test('should handle merging of two separate primary contacts', async () => {
    // Create two separate primary contacts
    const contact1 = await prisma.contact.create({
      data: {
        email: 'george@hillvalley.edu',
        phoneNumber: '919191',
        linkPrecedence: 'primary'
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to ensure different timestamps

    const contact2 = await prisma.contact.create({
      data: {
        email: 'biffsucks@hillvalley.edu',
        phoneNumber: '717171',
        linkPrecedence: 'primary'
      }
    });

    // Request that links them
    const response = await request(app)
      .post('/identify')
      .send({ email: 'george@hillvalley.edu', phoneNumber: '717171' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact).toMatchObject({
      primaryContatctId: contact1.id, // Older contact should remain primary
      emails: expect.arrayContaining(['george@hillvalley.edu', 'biffsucks@hillvalley.edu']),
      phoneNumbers: expect.arrayContaining(['919191', '717171']),
      secondaryContactIds: expect.arrayContaining([contact2.id])
    });

    // Verify primary contact's email comes first
    expect(response.body.contact.emails[0]).toBe('george@hillvalley.edu');
    expect(response.body.contact.phoneNumbers[0]).toBe('919191');
  });

  test('should return existing data when exact match found', async () => {
    const contact = await prisma.contact.create({
      data: {
        email: 'lorraine@hillvalley.edu',
        phoneNumber: '123456',
        linkPrecedence: 'primary'
      }
    });

    const response = await request(app)
      .post('/identify')
      .send({ email: 'lorraine@hillvalley.edu', phoneNumber: '123456' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact).toMatchObject({
      primaryContatctId: contact.id,
      emails: ['lorraine@hillvalley.edu'],
      phoneNumbers: ['123456'],
      secondaryContactIds: []
    });
  });

  test('should work with only email provided', async () => {
    await prisma.contact.create({
      data: {
        email: 'lorraine@hillvalley.edu',
        phoneNumber: '123456',
        linkPrecedence: 'primary'
      }
    });

    const response = await request(app)
      .post('/identify')
      .send({ email: 'lorraine@hillvalley.edu' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact.emails).toEqual(['lorraine@hillvalley.edu']);
    expect(response.body.contact.phoneNumbers).toEqual(['123456']);
  });

  test('should work with only phoneNumber provided', async () => {
    await prisma.contact.create({
      data: {
        email: 'lorraine@hillvalley.edu',
        phoneNumber: '123456',
        linkPrecedence: 'primary'
      }
    });

    const response = await request(app)
      .post('/identify')
      .send({ phoneNumber: '123456' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact.emails).toEqual(['lorraine@hillvalley.edu']);
    expect(response.body.contact.phoneNumbers).toEqual(['123456']);
  });

  test('should handle complex linking scenario', async () => {
    // Create primary contact
    const primary = await prisma.contact.create({
      data: {
        email: 'lorraine@hillvalley.edu',
        phoneNumber: '123456',
        linkPrecedence: 'primary'
      }
    });

    // Create secondary contact
    await prisma.contact.create({
      data: {
        email: 'mcfly@hillvalley.edu',
        phoneNumber: '123456',
        linkPrecedence: 'secondary',
        linkedId: primary.id
      }
    });

    // Request with new phone number but existing email
    const response = await request(app)
      .post('/identify')
      .send({ email: 'mcfly@hillvalley.edu', phoneNumber: '789012' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact.emails).toEqual(['lorraine@hillvalley.edu', 'mcfly@hillvalley.edu']);
    expect(response.body.contact.phoneNumbers).toEqual(expect.arrayContaining(['123456', '789012']));
    expect(response.body.contact.secondaryContactIds).toHaveLength(2);
  });

  test('should return 400 for missing email and phoneNumber', async () => {
    const response = await request(app)
      .post('/identify')
      .send({})
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'At least one of email or phoneNumber is required' });
  });

  test('should return 400 for invalid email format', async () => {
    const response = await request(app)
      .post('/identify')
      .send({ email: 'invalid-email', phoneNumber: '123456' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid email format' });
  });

  test('should return 400 for invalid phone number format', async () => {
    const response = await request(app)
      .post('/identify')
      .send({ email: 'test@example.com', phoneNumber: 'abc123' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Phone number must be numeric' });
  });

  test('should handle null values correctly', async () => {
    const response = await request(app)
      .post('/identify')
      .send({ email: null, phoneNumber: '123456' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact.emails).toEqual([]);
    expect(response.body.contact.phoneNumbers).toEqual(['123456']);
  });
});