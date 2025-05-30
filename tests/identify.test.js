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

  test('should create secondary contact with new email and existing phone', async () => {
    // Create initial primary contact
    const primaryContact = await prisma.contact.create({
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
    expect(response.body.contact).toMatchObject({
      primaryContatctId: primaryContact.id,
      emails: ['lorraine@hillvalley.edu', 'mcfly@hillvalley.edu'],
      phoneNumbers: ['123456'],
      secondaryContactIds: expect.arrayContaining([expect.any(Number)])
    });
    expect(response.body.contact.secondaryContactIds).toHaveLength(1);
  });

  test('should merge two separate primary contacts - oldest remains primary', async () => {
    // Create first primary contact (older)
    const contact1 = await prisma.contact.create({
      data: {
        email: 'george@hillvalley.edu',
        phoneNumber: '919191',
        linkPrecedence: 'primary',
        createdAt: new Date('2023-04-11T00:00:00.374Z')
      }
    });

    // Wait to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 10));

    // Create second primary contact (newer)
    const contact2 = await prisma.contact.create({
      data: {
        email: 'biffsucks@hillvalley.edu',
        phoneNumber: '717171',
        linkPrecedence: 'primary',
        createdAt: new Date('2023-04-21T05:30:00.11Z')
      }
    });

    // Request that links them through cross-referencing
    const response = await request(app)
      .post('/identify')
      .send({ email: 'george@hillvalley.edu', phoneNumber: '717171' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact).toMatchObject({
      primaryContatctId: contact1.id, // Older contact should remain primary
      emails: ['george@hillvalley.edu', 'biffsucks@hillvalley.edu'],
      phoneNumbers: ['919191', '717171'],
      secondaryContactIds: expect.arrayContaining([contact2.id])
    });

    // Verify the order - primary contact's data comes first
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
    const contact = await prisma.contact.create({
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
    expect(response.body.contact).toMatchObject({
      primaryContatctId: contact.id,
      emails: ['lorraine@hillvalley.edu'],
      phoneNumbers: ['123456'],
      secondaryContactIds: []
    });
  });

  test('should work with only phoneNumber provided', async () => {
    const contact = await prisma.contact.create({
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
    expect(response.body.contact).toMatchObject({
      primaryContatctId: contact.id,
      emails: ['lorraine@hillvalley.edu'],
      phoneNumbers: ['123456'],
      secondaryContactIds: []
    });
  });

  test('should handle complex chaining scenario', async () => {
    // Create primary contact
    const primary = await prisma.contact.create({
      data: {
        email: 'lorraine@hillvalley.edu',
        phoneNumber: '123456',
        linkPrecedence: 'primary'
      }
    });

    // Create first secondary contact
    const secondary1 = await prisma.contact.create({
      data: {
        email: 'mcfly@hillvalley.edu',
        phoneNumber: '123456',
        linkPrecedence: 'secondary',
        linkedId: primary.id
      }
    });

    // Request with existing secondary email but new phone number
    const response = await request(app)
      .post('/identify')
      .send({ email: 'mcfly@hillvalley.edu', phoneNumber: '789012' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact).toMatchObject({
      primaryContatctId: primary.id,
      emails: ['lorraine@hillvalley.edu', 'mcfly@hillvalley.edu'],
      phoneNumbers: expect.arrayContaining(['123456', '789012']),
      secondaryContactIds: expect.arrayContaining([secondary1.id, expect.any(Number)])
    });
    expect(response.body.contact.secondaryContactIds).toHaveLength(2);
  });

  test('should create new primary when no matches exist', async () => {
    const response = await request(app)
      .post('/identify')
      .send({ email: 'new@example.com', phoneNumber: '999999' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact).toMatchObject({
      primaryContatctId: expect.any(Number),
      emails: ['new@example.com'],
      phoneNumbers: ['999999'],
      secondaryContactIds: []
    });
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

  test('should handle phoneNumber as number type', async () => {
    const response = await request(app)
      .post('/identify')
      .send({ email: 'test@example.com', phoneNumber: 123456 })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact.phoneNumbers).toEqual(['123456']);
  });

  test('should handle null email correctly', async () => {
    const response = await request(app)
      .post('/identify')
      .send({ email: null, phoneNumber: '123456' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact.emails).toEqual([]);
    expect(response.body.contact.phoneNumbers).toEqual(['123456']);
  });

  test('should handle null phoneNumber correctly', async () => {
    const response = await request(app)
      .post('/identify')
      .send({ email: 'test@example.com', phoneNumber: null })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.contact.emails).toEqual(['test@example.com']);
    expect(response.body.contact.phoneNumbers).toEqual([]);
  });

  test('should handle the exact example from problem statement', async () => {
    // First request
    const response1 = await request(app)
      .post('/identify')
      .send({ email: 'lorraine@hillvalley.edu', phoneNumber: '123456' })
      .set('Content-Type', 'application/json');

    expect(response1.status).toBe(200);
    const primaryId = response1.body.contact.primaryContatctId;

    // Second request - should create secondary
    const response2 = await request(app)
      .post('/identify')
      .send({ email: 'mcfly@hillvalley.edu', phoneNumber: '123456' })
      .set('Content-Type', 'application/json');

    expect(response2.status).toBe(200);
    expect(response2.body.contact).toMatchObject({
      primaryContatctId: primaryId,
      emails: ['lorraine@hillvalley.edu', 'mcfly@hillvalley.edu'],
      phoneNumbers: ['123456'],
      secondaryContactIds: expect.arrayContaining([expect.any(Number)])
    });

    // Third request - any of the variations should return same result
    const response3 = await request(app)
      .post('/identify')
      .send({ phoneNumber: '123456' })
      .set('Content-Type', 'application/json');

    expect(response3.status).toBe(200);
    expect(response3.body).toEqual(response2.body);
  });
});