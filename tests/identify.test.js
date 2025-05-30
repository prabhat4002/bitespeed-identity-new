const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');

router.post('/', async (req, res) => {
  const { email, phoneNumber } = req.body;

  // Input validation
  if (!email && !phoneNumber) {
    return res.status(400).json({ error: 'At least one of email or phoneNumber is required' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  // Allow string phone numbers (as per problem statement examples)
  if (phoneNumber && (typeof phoneNumber !== 'string' && typeof phoneNumber !== 'number')) {
    return res.status(400).json({ error: 'Phone number must be a string or number' });
  }

  // Convert phoneNumber to string for consistent handling
  const phoneStr = phoneNumber ? String(phoneNumber) : null;

  try {
    const result = await prisma.$transaction(async (prisma) => {
      // Find all contacts that match either email or phoneNumber
      const matchingContacts = await prisma.contact.findMany({
        where: {
          OR: [
            ...(email ? [{ email }] : []),
            ...(phoneStr ? [{ phoneNumber: phoneStr }] : []),
          ],
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' }
      });

      // If no matching contacts, create a new primary contact
      if (matchingContacts.length === 0) {
        const newContact = await prisma.contact.create({
          data: {
            email: email || null,
            phoneNumber: phoneStr || null,
            linkPrecedence: 'primary',
          },
        });

        return {
          contact: {
            primaryContactId: newContact.id,
            emails: newContact.email ? [newContact.email] : [],
            phoneNumbers: newContact.phoneNumber ? [newContact.phoneNumber] : [],
            secondaryContactIds: [],
          },
        };
      }

      // Find all primary contacts in the matching contacts
      const primaryContacts = [];
      const secondaryContactIds = new Set();

      for (const contact of matchingContacts) {
        if (contact.linkPrecedence === 'primary') {
          primaryContacts.push(contact);
        } else {
          secondaryContactIds.add(contact.linkedId);
        }
      }

      // Get all primary contacts (including those linked to secondary contacts)
      const allPrimaryContactIds = [...primaryContacts.map(c => c.id), ...Array.from(secondaryContactIds)];
      const uniquePrimaryContactIds = [...new Set(allPrimaryContactIds)];
      
      const allPrimaryContacts = await prisma.contact.findMany({
        where: {
          id: { in: uniquePrimaryContactIds },
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' }
      });

      // The oldest primary contact is our main primary
      const mainPrimaryContact = allPrimaryContacts[0];
      const otherPrimaryContacts = allPrimaryContacts.slice(1);

      // Convert other primary contacts to secondary if needed
      for (const primaryContact of otherPrimaryContacts) {
        await prisma.contact.update({
          where: { id: primaryContact.id },
          data: {
            linkPrecedence: 'secondary',
            linkedId: mainPrimaryContact.id,
            updatedAt: new Date(),
          },
        });

        // Update all contacts linked to this former primary
        await prisma.contact.updateMany({
          where: {
            linkedId: primaryContact.id,
            deletedAt: null,
          },
          data: {
            linkedId: mainPrimaryContact.id,
            updatedAt: new Date(),
          },
        });
      }

      // Check if we need to create a new secondary contact
      const allRelatedContacts = await prisma.contact.findMany({
        where: {
          OR: [
            { id: mainPrimaryContact.id },
            { linkedId: mainPrimaryContact.id },
          ],
          deletedAt: null,
        },
      });

      // Check if the exact contact already exists
      const exactMatchExists = allRelatedContacts.some(
        c => c.email === email && c.phoneNumber === phoneStr
      );

      let newSecondaryContact = null;
      if (!exactMatchExists) {
        const hasNewEmail = email && !allRelatedContacts.some(c => c.email === email);
        const hasNewPhone = phoneStr && !allRelatedContacts.some(c => c.phoneNumber === phoneStr);

        if (hasNewEmail || hasNewPhone) {
          newSecondaryContact = await prisma.contact.create({
            data: {
              email: email || null,
              phoneNumber: phoneStr || null,
              linkPrecedence: 'secondary',
              linkedId: mainPrimaryContact.id,
            },
          });
        }
      }

      // Get all contacts in the consolidated group
      const finalContacts = newSecondaryContact 
        ? [...allRelatedContacts, newSecondaryContact]
        : allRelatedContacts;

      // Prepare response data
      const emails = new Set();
      const phoneNumbers = new Set();
      const secondaryContactIds = [];

      // Add primary contact data first
      if (mainPrimaryContact.email) emails.add(mainPrimaryContact.email);
      if (mainPrimaryContact.phoneNumber) phoneNumbers.add(mainPrimaryContact.phoneNumber);

      // Add secondary contacts
      for (const contact of finalContacts) {
        if (contact.id !== mainPrimaryContact.id) {
          secondaryContactIds.push(contact.id);
          if (contact.email) emails.add(contact.email);
          if (contact.phoneNumber) phoneNumbers.add(contact.phoneNumber);
        }
      }

      return {
        contact: {
          primaryContactId: mainPrimaryContact.id,
          emails: Array.from(emails),
          phoneNumbers: Array.from(phoneNumbers),
          secondaryContactIds: secondaryContactIds.sort((a, b) => a - b),
        },
      };
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Error in /identify:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;