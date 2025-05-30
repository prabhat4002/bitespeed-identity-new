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
      // Find existing contacts
      const existingContacts = await prisma.contact.findMany({
        where: {
          OR: [
            { email: email || null },
            { phoneNumber: phoneNumber || null },
          ],
          deletedAt: null,
        },
      });

      let primaryContact = null;
      let secondaryContacts = [];

      if (existingContacts.length === 0) {
        // Create new primary contact
        primaryContact = await prisma.contact.create({
          data: {
            email,
            phoneNumber,
            linkPrecedence: 'primary',
          },
        });
      } else {
        // Find primary contact (earliest created)
        primaryContact = existingContacts.reduce((earliest, contact) => {
          if (contact.linkPrecedence === 'primary' && (!earliest || contact.createdAt < earliest.createdAt)) {
            return contact;
          }
          return earliest || contact;
        }, null);

        // Handle multiple primaries (merge into earliest)
        const otherContacts = existingContacts.filter(c => c.id !== primaryContact.id);
        for (const contact of otherContacts) {
          if (contact.linkPrecedence === 'primary') {
            // Convert to secondary
            await prisma.contact.update({
              where: { id: contact.id },
              data: {
                linkPrecedence: 'secondary',
                linkedId: primaryContact.id,
              },
            });
            secondaryContacts.push(contact.id);
          } else {
            secondaryContacts.push(contact.id);
          }
        }

        // Check if new data requires a new secondary contact
        const hasNewData = !existingContacts.some(c => c.email === email && c.phoneNumber === phoneNumber);
        if (hasNewData) {
          const newContact = await prisma.contact.create({
            data: {
              email,
              phoneNumber,
              linkPrecedence: 'secondary',
              linkedId: primaryContact.id,
            },
          });
          secondaryContacts.push(newContact.id);
        }
      }

      // Fetch all related contacts for response
      const relatedContacts = await prisma.contact.findMany({
        where: {
          OR: [
            { id: primaryContact.id },
            { linkedId: primaryContact.id },
          ],
          deletedAt: null,
        },
      });

      // Prepare response
      const emails = [...new Set(relatedContacts.map(c => c.email).filter(e => e))];
      const phoneNumbers = [...new Set(relatedContacts.map(c => c.phoneNumber).filter(p => p))];
      const secondaryContactIds = relatedContacts
        .filter(c => c.id !== primaryContact.id)
        .map(c => c.id);

      // Ensure primary contact's email/phone are first
      if (primaryContact.email) {
        emails.splice(emails.indexOf(primaryContact.email), 1);
        emails.unshift(primaryContact.email);
      }
      if (primaryContact.phoneNumber) {
        phoneNumbers.splice(phoneNumbers.indexOf(primaryContact.phoneNumber), 1);
        phoneNumbers.unshift(primaryContact.phoneNumber);
      }

      return {
        contact: {
          primaryContatctId: primaryContact.id,
          emails,
          phoneNumbers,
          secondaryContactIds,
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