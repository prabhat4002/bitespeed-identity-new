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
  if (phoneNumber && !/^\d+$/.test(phoneNumber)) {
    return res.status(400).json({ error: 'Phone number must be numeric' });
  }

  try {
    // Use transaction to ensure atomicity
    const result = await prisma.$transaction(async (prisma) => {
      // Find existing contacts that match email or phoneNumber
      const existingContacts = await prisma.contact.findMany({
        where: {
          OR: [
            { email: email || null },
            { phoneNumber: phoneNumber || null },
          ],
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' }
      });

      if (existingContacts.length === 0) {
        // Create new primary contact
        const primaryContact = await prisma.contact.create({
          data: {
            email,
            phoneNumber,
            linkPrecedence: 'primary',
          },
        });

        return {
          contact: {
            primaryContatctId: primaryContact.id,
            emails: primaryContact.email ? [primaryContact.email] : [],
            phoneNumbers: primaryContact.phoneNumber ? [primaryContact.phoneNumber] : [],
            secondaryContactIds: [],
          },
        };
      }

      // Find all primary contact IDs that we need to consider
      const primaryContactIds = new Set();
      
      existingContacts.forEach(contact => {
        if (contact.linkPrecedence === 'primary') {
          primaryContactIds.add(contact.id);
        } else if (contact.linkedId) {
          primaryContactIds.add(contact.linkedId);
        }
      });

      // Get the oldest primary contact (this will be our final primary)
      const primaryContacts = await prisma.contact.findMany({
        where: {
          id: { in: Array.from(primaryContactIds) },
          deletedAt: null
        },
        orderBy: { createdAt: 'asc' }
      });

      const finalPrimaryContact = primaryContacts[0];

      // If there are multiple primaries, convert others to secondary
      if (primaryContacts.length > 1) {
        for (let i = 1; i < primaryContacts.length; i++) {
          await prisma.contact.update({
            where: { id: primaryContacts[i].id },
            data: {
              linkPrecedence: 'secondary',
              linkedId: finalPrimaryContact.id,
            },
          });

          // Update all contacts that were linked to this former primary
          await prisma.contact.updateMany({
            where: {
              linkedId: primaryContacts[i].id,
              deletedAt: null
            },
            data: {
              linkedId: finalPrimaryContact.id,
            },
          });
        }
      }

      // Get all contacts in this identity chain
      const allRelatedContacts = await prisma.contact.findMany({
        where: {
          OR: [
            { id: finalPrimaryContact.id },
            { linkedId: finalPrimaryContact.id }
          ],
          deletedAt: null
        },
        orderBy: { createdAt: 'asc' }
      });

      // Check if we need to create a new secondary contact
      const exactMatch = allRelatedContacts.find(contact => 
        contact.email === email && contact.phoneNumber === phoneNumber
      );

      if (!exactMatch) {
        // Check if this request provides new information
        const hasNewEmail = email && !allRelatedContacts.some(c => c.email === email);
        const hasNewPhone = phoneNumber && !allRelatedContacts.some(c => c.phoneNumber === phoneNumber);
        
        if (hasNewEmail || hasNewPhone) {
          const newContact = await prisma.contact.create({
            data: {
              email,
              phoneNumber,
              linkPrecedence: 'secondary',
              linkedId: finalPrimaryContact.id,
            },
          });
          
          allRelatedContacts.push(newContact);
        }
      }

      // Prepare response data
      const secondaryContacts = allRelatedContacts.filter(c => c.id !== finalPrimaryContact.id);
      
      // Collect unique emails and phone numbers, with primary contact's data first
      const emails = [];
      const phoneNumbers = [];

      // Add primary contact's data first
      if (finalPrimaryContact.email) emails.push(finalPrimaryContact.email);
      if (finalPrimaryContact.phoneNumber) phoneNumbers.push(finalPrimaryContact.phoneNumber);

      // Add secondary contacts' unique data
      secondaryContacts.forEach(contact => {
        if (contact.email && !emails.includes(contact.email)) {
          emails.push(contact.email);
        }
        if (contact.phoneNumber && !phoneNumbers.includes(contact.phoneNumber)) {
          phoneNumbers.push(contact.phoneNumber);
        }
      });

      return {
        contact: {
          primaryContatctId: finalPrimaryContact.id,
          emails,
          phoneNumbers,
          secondaryContactIds: secondaryContacts.map(c => c.id),
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