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
      // Find existing contacts that match email or phoneNumber
      const existingContacts = await prisma.contact.findMany({
        where: {
          OR: [
            ...(email ? [{ email: email }] : []),
            ...(phoneStr ? [{ phoneNumber: phoneStr }] : []),
          ],
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' }
      });

      // If no existing contacts, create new primary contact
      if (existingContacts.length === 0) {
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

      // Find all connected contacts (including those linked to found contacts)
      const allConnectedContactIds = new Set();
      const primaryContactIds = new Set();

      // Add direct matches
      existingContacts.forEach(contact => {
        allConnectedContactIds.add(contact.id);
        if (contact.linkPrecedence === 'primary') {
          primaryContactIds.add(contact.id);
        } else if (contact.linkedId) {
          primaryContactIds.add(contact.linkedId);
        }
      });

      // Get all primary contacts involved
      const primaryContacts = await prisma.contact.findMany({
        where: {
          id: { in: Array.from(primaryContactIds) },
          deletedAt: null
        },
        orderBy: { createdAt: 'asc' }
      });

      // The oldest primary contact becomes the main primary
      const mainPrimaryContact = primaryContacts[0];

      // If there are multiple primary contacts, merge them
      if (primaryContacts.length > 1) {
        for (let i = 1; i < primaryContacts.length; i++) {
          const contactToUpdate = primaryContacts[i];
          
          // Convert this primary to secondary
          await prisma.contact.update({
            where: { id: contactToUpdate.id },
            data: {
              linkPrecedence: 'secondary',
              linkedId: mainPrimaryContact.id,
            },
          });

          // Update all contacts that were linked to this former primary
          await prisma.contact.updateMany({
            where: {
              linkedId: contactToUpdate.id,
              deletedAt: null
            },
            data: {
              linkedId: mainPrimaryContact.id,
            },
          });
        }
      }

      // Get all contacts in the final connected group
      const allRelatedContacts = await prisma.contact.findMany({
        where: {
          OR: [
            { id: mainPrimaryContact.id },
            { linkedId: mainPrimaryContact.id }
          ],
          deletedAt: null
        },
        orderBy: { createdAt: 'asc' }
      });

      // Check if we need to create a new secondary contact
      const hasExactMatch = allRelatedContacts.some(contact => 
        contact.email === email && contact.phoneNumber === phoneStr
      );

      let newSecondaryContact = null;
      if (!hasExactMatch) {
        // Check if this request provides genuinely new information
        const existingEmails = new Set(allRelatedContacts.map(c => c.email).filter(Boolean));
        const existingPhones = new Set(allRelatedContacts.map(c => c.phoneNumber).filter(Boolean));
        
        const hasNewInfo = (email && !existingEmails.has(email)) || 
                          (phoneStr && !existingPhones.has(phoneStr));

        if (hasNewInfo) {
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

      // Prepare final response
      const finalRelatedContacts = newSecondaryContact 
        ? [...allRelatedContacts, newSecondaryContact]
        : allRelatedContacts;

      const secondaryContacts = finalRelatedContacts.filter(c => c.id !== mainPrimaryContact.id);

      // Collect unique emails and phone numbers
      const emails = [];
      const phoneNumbers = [];

      // Add primary contact's data first
      if (mainPrimaryContact.email) emails.push(mainPrimaryContact.email);
      if (mainPrimaryContact.phoneNumber) phoneNumbers.push(mainPrimaryContact.phoneNumber);

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
          primaryContactId: mainPrimaryContact.id, // Fixed typo
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