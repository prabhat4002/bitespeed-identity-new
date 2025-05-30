const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

router.post('/identify', async (req, res) => {
  const { email, phoneNumber } = req.body;

  if (!email && !phoneNumber) {
    return res.status(400).json({ error: 'Either email or phoneNumber is required' });
  }

  try {
    // Find all contacts matching either email or phone number
    const contacts = await prisma.contact.findMany({
      where: {
        OR: [
          { email: email || undefined },
          { phoneNumber: phoneNumber || undefined }
        ]
      },
      orderBy: { createdAt: 'asc' } // ensure we find oldest (primary) first
    });

    if (contacts.length === 0) {
      // No existing contact, create new primary
      const newContact = await prisma.contact.create({
        data: {
          email,
          phoneNumber,
          linkPrecedence: 'primary'
        }
      });

      return res.json({
        contact: {
          primaryContatctId: newContact.id, // 👈 use the typo
          emails: [newContact.email],
          phoneNumbers: [newContact.phoneNumber],
          secondaryContactIds: []
        }
      });
    }

    // Find the oldest contact (primary)
    const primary = contacts.find(c => c.linkPrecedence === 'primary') || contacts[0];

    // Make sure all others are linked to the primary
    const contactIds = contacts.map(c => c.id);
    const toLink = contacts.filter(c => c.linkPrecedence === 'primary' && c.id !== primary.id);

    // Update other primary contacts to become secondary (dedupe)
    for (const c of toLink) {
      await prisma.contact.update({
        where: { id: c.id },
        data: {
          linkPrecedence: 'secondary',
          linkedId: primary.id
        }
      });
    }

    // Check if current email or phoneNumber is new info, and if so, create a secondary contact
    const existingEmails = contacts.map(c => c.email);
    const existingPhones = contacts.map(c => c.phoneNumber);

    let newSecondary = null;

    if (
      (email && !existingEmails.includes(email)) ||
      (phoneNumber && !existingPhones.includes(phoneNumber))
    ) {
      newSecondary = await prisma.contact.create({
        data: {
          email,
          phoneNumber,
          linkPrecedence: 'secondary',
          linkedId: primary.id
        }
      });
    }

    // Fetch updated contacts
    const allLinkedContacts = await prisma.contact.findMany({
      where: {
        OR: [
          { id: primary.id },
          { linkedId: primary.id }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });

    // Prepare response data
    const emails = [...new Set(allLinkedContacts.map(c => c.email).filter(Boolean))];
    const phoneNumbers = [...new Set(allLinkedContacts.map(c => c.phoneNumber).filter(Boolean))];
    const secondaryContactIds = allLinkedContacts
      .filter(c => c.linkPrecedence === 'secondary')
      .map(c => c.id);

    return res.json({
      contact: {
        primaryContatctId: primary.id, // 👈 match typo
        emails,
        phoneNumbers,
        secondaryContactIds
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
